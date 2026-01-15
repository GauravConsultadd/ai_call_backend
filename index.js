const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { TranscribeTranslatePipeline } = require("./services/transcribeTranslatePipeline");
const { RoomManager } = require("./services/roomManager");
const config = require("./config");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

const roomManager = new RoomManager();
const pipelines = new Map(); // Store active pipelines
const roomRoles = new Map(); // Store room -> { userId: role }

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activePipelines: pipelines.size,
    activeRooms: roomManager.getRoomCount(),
  });
});

// Stats endpoint
app.get("/stats", (req, res) => {
  const stats = {
    activePipelines: pipelines.size,
    activeRooms: roomManager.getRoomCount(),
    rooms: roomManager.getAllRooms().map(roomId => ({
      roomId,
      userCount: roomManager.getUserCount(roomId),
      users: roomManager.getUsers(roomId),
      roles: roomRoles.get(roomId) || {},
    })),
  };
  res.json(stats);
});

io.on("connection", (socket) => {
  console.log(`\n✅ [CONNECTION] User connected: ${socket.id}`);

  socket.on("join-room", async ({ roomId, role }) => {
    try {
      console.log(`\n🔑 [JOIN-ROOM] User ${socket.id} joining room: ${roomId}`);
      console.log(`   Role: ${role || 'not specified'}`);
      
      if (!roomId || typeof roomId !== "string") {
        console.error("❌ [JOIN-ROOM] Invalid room ID");
        socket.emit("error", { message: "Invalid room ID" });
        return;
      }

      // Determine role: first person = user (protected), second person = caller (potential scammer)
      const existingUsers = roomManager.getUsers(roomId);
      let assignedRole = role;
      
      if (!assignedRole) {
        if (existingUsers.length === 0) {
          assignedRole = "user"; // First person is the USER being protected
        } else {
          assignedRole = "caller"; // Second person is the CALLER
        }
      }

      // Store role information
      if (!roomRoles.has(roomId)) {
        roomRoles.set(roomId, {});
      }
      roomRoles.get(roomId)[socket.id] = assignedRole;

      console.log(`   ✅ Assigned role: ${assignedRole.toUpperCase()}`);
      console.log(`   Room roles:`, roomRoles.get(roomId));

      // Join the room
      await socket.join(roomId);
      roomManager.addUser(roomId, socket.id);

      // Get existing users
      const currentUsers = roomManager.getUsers(roomId).filter((id) => id !== socket.id);
      
      // Send role assignment and existing users to the new joiner
      socket.emit("role-assigned", { 
        role: assignedRole,
        socketId: socket.id,
        isProtected: assignedRole === "user"
      });
      
      socket.emit("existing-users", currentUsers.map(id => ({
        socketId: id,
        role: roomRoles.get(roomId)[id]
      })));

      // Notify others in the room
      socket.to(roomId).emit("user-joined", {
        socketId: socket.id,
        role: assignedRole
      });
      
      console.log(`✅ [JOIN-ROOM] User ${socket.id} (${assignedRole.toUpperCase()}) joined room: ${roomId}`);
      console.log(`   Total users in room: ${roomManager.getUserCount(roomId)}`);

      // Initialize the Pipeline
      console.log(`\n🔧 [SETUP] Initializing pipeline for ${assignedRole.toUpperCase()}: ${socket.id}...`);
      
      const pipeline = new TranscribeTranslatePipeline(roomId, socket.id, assignedRole);
      
      await pipeline.start(
        (pipelineOutput) => {
          // Handle complete pipeline output
          const speakerRole = roomRoles.get(roomId)[socket.id];
          
          console.log(`\n📡 [EMIT] Pipeline output from ${speakerRole.toUpperCase()}: ${socket.id}`);
          console.log(`   Transcription: "${pipelineOutput.transcription.text}"`);
          console.log(`   Translation: "${pipelineOutput.translation.text}"`);

          // Emit transcript and translation to everyone in room
          io.to(roomId).emit("transcript", {
            text: pipelineOutput.transcription.text,
            speaker: socket.id,
            speakerRole: speakerRole,
            timestamp: pipelineOutput.timestamp,
          });

          io.to(roomId).emit("translation", {
            originalText: pipelineOutput.transcription.text,
            translatedText: pipelineOutput.translation.text,
            sourceLanguage: pipelineOutput.transcription.language,
            targetLanguage: pipelineOutput.translation.language,
            speaker: socket.id,
            speakerRole: speakerRole,
            timestamp: pipelineOutput.timestamp,
          });

          // CRITICAL: Only send scam alerts if the CALLER spoke
          if (pipelineOutput.scamAnalysis && speakerRole === "caller") {
            console.log(`   🚨 Scam analysis available (Caller spoke)`);
            console.log(`   Risk Level: ${pipelineOutput.scamAnalysis.riskLevel}`);
            console.log(`   Scam Probability: ${pipelineOutput.scamAnalysis.scamProbability}%`);

            // Find the USER in this room to send them the alert
            const userSocketId = Object.entries(roomRoles.get(roomId))
              .find(([_, role]) => role === "user")?.[0];

            if (userSocketId) {
              // Send alert ONLY to the USER (the person being protected)
              io.to(userSocketId).emit("scam-alert", {
                callerMessage: pipelineOutput.translation.text,
                summary: pipelineOutput.scamAnalysis.summary,
                scamProbability: pipelineOutput.scamAnalysis.scamProbability,
                riskLevel: pipelineOutput.scamAnalysis.riskLevel,
                concerns: pipelineOutput.scamAnalysis.concerns,
                reasoning: pipelineOutput.scamAnalysis.reasoning,
                recommendedAction: pipelineOutput.scamAnalysis.recommendedAction,
                timestamp: pipelineOutput.timestamp,
              });

              console.log(`   ✅ Scam alert sent to USER: ${userSocketId}`);

              // Also emit to admin/monitoring dashboard (optional)
              io.to(roomId).emit("scam-detection-log", {
                roomId: roomId,
                callerSocketId: socket.id,
                userSocketId: userSocketId,
                analysis: pipelineOutput.scamAnalysis,
                timestamp: pipelineOutput.timestamp,
              });

              // Log for server monitoring
              logScamDetection(roomId, userSocketId, socket.id, pipelineOutput);
            } else {
              console.warn(`   ⚠️  No USER found in room to send alert`);
            }
          } else if (pipelineOutput.scamAnalysis) {
            console.log(`   ℹ️  Scam analysis skipped (User spoke, not caller)`);
          }

          // Emit complete pipeline output to the room for logging/monitoring
          io.to(roomId).emit("pipeline-output", {
            ...pipelineOutput,
            speaker: socket.id,
            speakerRole: speakerRole,
          });
        },
        {
          sourceLanguage: "hi",
          targetLanguage: "en",
          autoDetectLanguage: true,
          userRole: assignedRole, // Pass role to pipeline
        }
      );

      // Register speaker roles in ALL pipelines in this room
      console.log(`\n👥 [SETUP] Registering all speakers in room ${roomId}...`);
      const usersInRoom = roomManager.getUsers(roomId);
      const roomRoleMap = roomRoles.get(roomId);
      
      // Register all users (including this one) in ALL pipelines
      usersInRoom.forEach(userId => {
        const userPipeline = pipelines.get(userId);
        if (userPipeline && userPipeline.bedrockService) {
          // Register all speakers in this pipeline
          Object.entries(roomRoleMap).forEach(([speakerId, speakerRole]) => {
            userPipeline.bedrockService.registerSpeaker(speakerId, speakerRole);
            console.log(`   ✅ Registered ${speakerId} (${speakerRole}) in ${userId}'s pipeline`);
          });
        }
      });

      pipelines.set(socket.id, pipeline);
      console.log(`✅ [SETUP] Pipeline initialized for ${assignedRole.toUpperCase()}: ${socket.id}\n`);

    } catch (error) {
      console.error(`\n❌ [JOIN-ROOM] Error:`, error.message);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  socket.on("audio-stream", async ({ audio, roomId }) => {
    try {
      if (!audio || !roomId) {
        console.warn(`⚠️  [AUDIO-STREAM] Missing audio or roomId from ${socket.id}`);
        return;
      }

      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        const audioBuffer = Buffer.from(audio);
        await pipeline.sendAudio(audioBuffer);
      } else {
        console.warn(`⚠️  [AUDIO-STREAM] No pipeline found for user ${socket.id}`);
      }
    } catch (error) {
      console.error(`\n❌ [AUDIO-STREAM] Error processing audio:`, error.message);
    }
  });

  // Get pipeline statistics
  socket.on("get-stats", () => {
    try {
      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        const stats = pipeline.getStats();
        socket.emit("stats", stats);
        pipeline.printStats();
      } else {
        socket.emit("stats", { error: "No active pipeline" });
      }
    } catch (error) {
      console.error(`\n❌ [GET-STATS] Error:`, error.message);
    }
  });

  // Change target language
  socket.on("change-language", ({ targetLanguage }) => {
    try {
      console.log(`\n🔄 [CHANGE-LANGUAGE] User ${socket.id} changing to: ${targetLanguage}`);
      
      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        pipeline.setTargetLanguage(targetLanguage);
        socket.emit("language-changed", { targetLanguage });
        console.log(`✅ [CHANGE-LANGUAGE] Successfully changed to: ${targetLanguage}`);
      } else {
        console.warn(`⚠️  [CHANGE-LANGUAGE] No pipeline found for user ${socket.id}`);
      }
    } catch (error) {
      console.error(`\n❌ [CHANGE-LANGUAGE] Error:`, error.message);
    }
  });

  // Clear conversation history
  socket.on("clear-conversation", () => {
    try {
      console.log(`\n🗑️  [CLEAR-CONVERSATION] User ${socket.id} clearing history`);
      
      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        pipeline.clearConversationHistory();
        socket.emit("conversation-cleared");
        console.log(`✅ [CLEAR-CONVERSATION] History cleared for user ${socket.id}`);
      } else {
        console.warn(`⚠️  [CLEAR-CONVERSATION] No pipeline found for user ${socket.id}`);
      }
    } catch (error) {
      console.error(`\n❌ [CLEAR-CONVERSATION] Error:`, error.message);
    }
  });

  // WebRTC signaling
  socket.on("offer", ({ offer, to }) => {
    io.to(to).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", ({ answer, to }) => {
    io.to(to).emit("answer", { answer, from: socket.id });
  });

  socket.on("ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("ice-candidate", { candidate, from: socket.id });
  });

  socket.on("disconnect", async () => {
    console.log(`\n❌ [DISCONNECT] User disconnected: ${socket.id}`);

    // Stop and cleanup pipeline
    const pipeline = pipelines.get(socket.id);
    if (pipeline) {
      await pipeline.stop();
      pipelines.delete(socket.id);
      console.log(`✅ [DISCONNECT] Pipeline cleaned up for user ${socket.id}`);
    }

    // Remove user from rooms and clean up role info
    const rooms = roomManager.getUserRooms(socket.id);
    rooms.forEach((roomId) => {
      // Remove role
      if (roomRoles.has(roomId)) {
        const role = roomRoles.get(roomId)[socket.id];
        delete roomRoles.get(roomId)[socket.id];
        console.log(`➖ [DISCONNECT] Removed ${role?.toUpperCase() || 'UNKNOWN'} ${socket.id} from room ${roomId}`);
        
        // Clean up empty room roles
        if (Object.keys(roomRoles.get(roomId)).length === 0) {
          roomRoles.delete(roomId);
        }
      }
      
      roomManager.removeUser(roomId, socket.id);
      socket.to(roomId).emit("user-left", socket.id);
    });

    console.log(`   Active pipelines: ${pipelines.size}`);
    console.log(`   Active rooms: ${roomManager.getRoomCount()}\n`);
  });
});

/**
 * Log scam detection results for monitoring
 */
function logScamDetection(roomId, userSocketId, callerSocketId, pipelineOutput) {
  const { scamAnalysis, translation } = pipelineOutput;
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    roomId,
    userSocketId,
    callerSocketId,
    callerMessage: translation.text,
    scamProbability: scamAnalysis.scamProbability,
    riskLevel: scamAnalysis.riskLevel,
    concerns: scamAnalysis.concerns,
    summary: scamAnalysis.summary,
    recommendedAction: scamAnalysis.recommendedAction,
  };

  // Log to console with appropriate severity
  if (scamAnalysis.riskLevel === "HIGH") {
    console.log(`\n${'🚨'.repeat(40)}`);
    console.log(`🚨 [HIGH RISK SCAM DETECTED] 🚨`);
    console.log(`${'🚨'.repeat(40)}`);
    console.log(`   Room: ${roomId}`);
    console.log(`   USER (Protected): ${userSocketId}`);
    console.log(`   CALLER (Scammer): ${callerSocketId}`);
    console.log(`   Probability: ${scamAnalysis.scamProbability}%`);
    console.log(`   Caller said: "${translation.text}"`);
    console.log(`   Summary: ${scamAnalysis.summary}`);
    console.log(`   Concerns: ${scamAnalysis.concerns.join(', ')}`);
    console.log(`   ⚠️  RECOMMENDED ACTION: ${scamAnalysis.recommendedAction}`);
    console.log(`   ✅ ALERT SENT TO USER: ${userSocketId}`);
    console.log(`${'🚨'.repeat(40)}\n`);
  } else if (scamAnalysis.riskLevel === "MEDIUM") {
    console.log(`\n⚠️  [MEDIUM RISK DETECTED]`);
    console.log(`   Room: ${roomId}`);
    console.log(`   USER: ${userSocketId} | CALLER: ${callerSocketId}`);
    console.log(`   Probability: ${scamAnalysis.scamProbability}%`);
    console.log(`   Caller said: "${translation.text}"`);
    console.log(`   Concerns: ${scamAnalysis.concerns.join(', ')}`);
    console.log(`   Recommended Action: ${scamAnalysis.recommendedAction}\n`);
  }

  // In production, you would:
  // 1. Store in database with user/caller identification
  // 2. Send SMS/email alerts to family members if HIGH risk
  // 3. Log to centralized monitoring service
  // 4. Trigger automated actions (call recording, etc.)
  
  // Example: Store in database
  // await db.scamDetections.insert(logEntry);
  
  // Example: Send alert to user's family
  // if (scamAnalysis.riskLevel === 'HIGH') {
  //   await sendFamilyAlert(userSocketId, logEntry);
  // }
}

const PORT = config.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Server Started Successfully`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${config.NODE_ENV}`);
  console.log(`   AWS Region: ${config.AWS_REGION}`);
  console.log(`   Allowed Origins: ${config.ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Scam Detection: ENABLED (Bedrock)`);
  console.log(`   Protection Mode: USER-FOCUSED`);
  console.log(`${'='.repeat(80)}`);
  console.log(`\n📡 Waiting for connections...\n`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`🛑 Shutting down server gracefully...`);
  console.log(`${'='.repeat(80)}`);

  // Stop all active pipelines
  console.log(`\n🔄 Stopping ${pipelines.size} active pipelines...`);
  for (const [socketId, pipeline] of pipelines.entries()) {
    console.log(`   Stopping pipeline for user: ${socketId}`);
    await pipeline.stop();
  }
  pipelines.clear();
  roomRoles.clear();

  console.log(`\n✅ All pipelines stopped`);
  console.log(`🔌 Closing server...`);

  server.close(() => {
    console.log(`\n✅ Server closed successfully`);
    console.log(`${'='.repeat(80)}\n`);
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error(`\n⚠️  Forced shutdown after timeout`);
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { app, server, io };