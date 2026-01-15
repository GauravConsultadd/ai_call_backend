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
const pipelines = new Map();

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activePipelines: pipelines.size,
    activeRooms: roomManager.getRoomCount(),
  });
});

io.on("connection", (socket) => {
  console.log(`\n✅ [CONNECTION] User connected: ${socket.id}`);

  socket.on("join-room", async ({roomId}) => {
    try {
      console.log(roomId)
      console.log(`\n🔑 [JOIN-ROOM] User ${socket.id} joining room: ${roomId}`);
      
      if (!roomId || typeof roomId !== "string") {
        socket.emit("error", { message: "Invalid room ID" });
        return;
      }

      // Join the room
      await socket.join(roomId);
      roomManager.addUser(roomId, socket.id);

      const existingUsers = roomManager.getUsers(roomId).filter((id) => id !== socket.id);
      socket.emit("existing-users", existingUsers);
      socket.to(roomId).emit("user-joined", socket.id);
      
      console.log(`✅ [JOIN-ROOM] User ${socket.id} joined room: ${roomId}`);
      console.log(`   Total users: ${roomManager.getUserCount(roomId)}`);

      // Initialize Pipeline
      console.log(`\n🔧 [SETUP] Initializing pipeline for ${socket.id}...`);
      
      const pipeline = new TranscribeTranslatePipeline(roomId, socket.id);
      
      await pipeline.start(
        (pipelineOutput) => {
          // Emit transcript to everyone
          io.to(roomId).emit("transcript", {
            text: pipelineOutput.transcription.text,
            language: pipelineOutput.transcription.language,
            speaker: socket.id,
            timestamp: pipelineOutput.timestamp,
          });

          // Emit translation to everyone
          io.to(roomId).emit("translation", {
            originalText: pipelineOutput.transcription.text,
            translatedText: pipelineOutput.translation.text,
            sourceLanguage: pipelineOutput.transcription.language,
            targetLanguage: pipelineOutput.translation.language,
            speaker: socket.id,
            timestamp: pipelineOutput.timestamp,
          });

          // EMIT FRAUD SCORE TO EVERYONE IN THE ROOM
          if (pipelineOutput.fraudAnalysis) {
            console.log(`\n📊 [FRAUD SCORE] Broadcasting to room ${roomId}`);
            console.log(`   Speaker: ${socket.id}`);
            console.log(`   Fraud Score: ${pipelineOutput.fraudAnalysis.fraudScore}%`);
            console.log(`   Risk Level: ${pipelineOutput.fraudAnalysis.riskLevel}`);

            // Emit to ENTIRE ROOM - everyone sees the fraud score
            io.to(roomId).emit("fraud-score", {
              speaker: socket.id,
              message: pipelineOutput.translation.text,
              summary: pipelineOutput.fraudAnalysis.summary,
              fraudScore: pipelineOutput.fraudAnalysis.fraudScore,
              riskLevel: pipelineOutput.fraudAnalysis.riskLevel,
              redFlags: pipelineOutput.fraudAnalysis.redFlags,
              reasoning: pipelineOutput.fraudAnalysis.reasoning,
              matchedPatterns: pipelineOutput.fraudAnalysis.matchedPatterns,
              timestamp: pipelineOutput.timestamp,
            });

            // Log for monitoring
            logFraudDetection(roomId, socket.id, pipelineOutput);
          }

          // Complete pipeline output
          io.to(roomId).emit("pipeline-output", {
            ...pipelineOutput,
            speaker: socket.id,
          });
        },
        {
          sourceLanguage: "hi",
          targetLanguage: "en",
          autoDetectLanguage: true,
        }
      );

      pipelines.set(socket.id, pipeline);
      console.log(`✅ [SETUP] Pipeline initialized for ${socket.id}\n`);

    } catch (error) {
      console.error(`\n❌ [JOIN-ROOM] Error:`, error.message);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  socket.on("audio-stream", async ({ audio, roomId }) => {
    try {
      if (!audio || !roomId) {
        return;
      }

      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        const audioBuffer = Buffer.from(audio);
        await pipeline.sendAudio(audioBuffer);
      }
    } catch (error) {
      console.error(`\n❌ [AUDIO-STREAM] Error:`, error.message);
    }
  });

  // Get stats
  socket.on("get-stats", () => {
    try {
      const pipeline = pipelines.get(socket.id);
      if (pipeline) {
        const stats = pipeline.getStats();
        socket.emit("stats", stats);
      } else {
        socket.emit("stats", { error: "No active pipeline" });
      }
    } catch (error) {
      console.error(`\n❌ [GET-STATS] Error:`, error.message);
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

    const pipeline = pipelines.get(socket.id);
    if (pipeline) {
      await pipeline.stop();
      pipelines.delete(socket.id);
    }

    const rooms = roomManager.getUserRooms(socket.id);
    rooms.forEach((roomId) => {
      roomManager.removeUser(roomId, socket.id);
      socket.to(roomId).emit("user-left", socket.id);
    });

    console.log(`   Active pipelines: ${pipelines.size}\n`);
  });
});

/**
 * Log fraud detection for monitoring
 */
function logFraudDetection(roomId, speakerId, pipelineOutput) {
  const { fraudAnalysis, translation } = pipelineOutput;
  
  if (fraudAnalysis.riskLevel === "HIGH") {
    console.log(`\n${'🚨'.repeat(40)}`);
    console.log(`🚨 [HIGH FRAUD RISK DETECTED] 🚨`);
    console.log(`${'🚨'.repeat(40)}`);
    console.log(`   Room: ${roomId}`);
    console.log(`   Speaker: ${speakerId}`);
    console.log(`   Fraud Score: ${fraudAnalysis.fraudScore}%`);
    console.log(`   Message: "${translation.text}"`);
    console.log(`   Summary: ${fraudAnalysis.summary}`);
    console.log(`   Red Flags: ${fraudAnalysis.redFlags.join(', ')}`);
    console.log(`   Matched Patterns: ${fraudAnalysis.matchedPatterns.join(', ')}`);
    console.log(`${'🚨'.repeat(40)}\n`);
    
    // In production: Send alerts, store in database, trigger monitoring
    // await db.fraudDetections.insert({ roomId, speakerId, fraudAnalysis });
    // await sendAlert({ roomId, speakerId, fraudAnalysis });
  } else if (fraudAnalysis.riskLevel === "MEDIUM") {
    console.log(`\n⚠️  [MEDIUM FRAUD RISK] Room: ${roomId}, Speaker: ${speakerId}`);
    console.log(`   Score: ${fraudAnalysis.fraudScore}%`);
    console.log(`   Red Flags: ${fraudAnalysis.redFlags.join(', ')}\n`);
  }
}

const PORT = config.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Server Started - Simplified Fraud Detection`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Mode: Bidirectional (analyzes all participants)`);
  console.log(`   Fraud scores: Broadcast to entire room`);
  console.log(`${'='.repeat(80)}\n`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log(`\n🛑 Shutting down...`);
  
  for (const [socketId, pipeline] of pipelines.entries()) {
    await pipeline.stop();
  }
  pipelines.clear();

  server.close(() => {
    console.log(`✅ Server closed\n`);
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { app, server, io };