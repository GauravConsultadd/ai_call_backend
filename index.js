const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { TranscriptionService } = require("./services/TranscriptionService");
const {
  TranscriptionPoolManager,
} = require("./services/TransactionPoolManager");
const { getLogger } = require("./services/cloudWatchLogger"); // ✅ ADD THIS LINE

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const rooms = new Map();
const transcriptionPool = new TranscriptionPoolManager(20);

// ✅ ADD THESE 3 LINES
const cwLogger = getLogger();
cwLogger.initialize().catch((err) => console.log("CloudWatch disabled"));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    activeConnections: transcriptionPool.getActiveCount(),
    maxConnections: transcriptionPool.maxConnections,
    rooms: rooms.size,
  });
});

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);
  cwLogger.log("User Connected", { socketId: socket.id }); // ✅ ADD THIS LINE

  socket.on("join-room", async (roomId) => {
    try {
      console.log(`📥 join-room event from ${socket.id} for room: ${roomId}`);

      socket.join(roomId);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      rooms.get(roomId).add(socket.id);

      if (!transcriptionPool.canAddConnection()) {
        console.error(`❌ Max transcription connections reached`);
        socket.emit("error", {
          message: "Server is at capacity. Please try again later.",
        });
        return;
      }

      console.log(`🎙️ Initializing transcription for ${socket.id}...`);
      const transcriptionService = new TranscriptionService(roomId, socket.id);

      transcriptionPool.addConnection(socket.id, transcriptionService);
      console.log(`✅ Transcription service PRE-stored for ${socket.id}`);

      try {
        await transcriptionService.start((transcript) => {
          console.log(
            `📝 Broadcasting transcript from ${socket.id}:`,
            transcript
          );

          // ✅ ADD THIS LINE
          cwLogger.log("Transcript", { userId: socket.id, text: transcript });

          io.to(roomId).emit("transcript", {
            text: transcript,
            speaker: socket.id,
            timestamp: new Date().toISOString(),
          });
        });

        console.log(`✅ Transcription fully initialized for ${socket.id}`);

        const stored = transcriptionPool.getConnection(socket.id);
        console.log(
          `🔍 Verification: Service stored = ${stored !== undefined}`
        );

        // ✅ ADD THIS LINE
        cwLogger.log("Transcription Started", { socketId: socket.id, roomId });
      } catch (error) {
        console.error(
          `❌ Failed to start transcription for ${socket.id}:`,
          error
        );
        transcriptionPool.removeConnection(socket.id);
        socket.emit("error", {
          message: "Failed to initialize transcription service",
        });
        return;
      }

      const usersInRoom = Array.from(rooms.get(roomId) || []).filter(
        (id) => id !== socket.id
      );

      socket.emit("existing-users", usersInRoom);
      socket.to(roomId).emit("user-joined", socket.id);
    } catch (error) {
      console.error(`❌ Error in join-room for ${socket.id}:`, error);
      cwLogger.log("Error in join-room", {
        socketId: socket.id,
        error: error.message,
      }); // ✅ ADD THIS LINE
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  socket.on("audio-stream", async (data) => {
    try {
      const { audio, roomId } = data;

      if (!audio || !Array.isArray(audio)) {
        console.error(`❌ Invalid audio data from ${socket.id}`);
        return;
      }

      const transcriptionService = transcriptionPool.getConnection(socket.id);

      if (!transcriptionService) {
        console.warn(
          `⚠️ No transcription service for ${socket.id} - service may still be initializing`
        );
        return;
      }

      const audioBuffer = Buffer.from(new Int16Array(audio).buffer);

      if (transcriptionService.audioChunksReceived % 100 === 0) {
        console.log(
          `📊 Audio chunk size: ${audioBuffer.length} bytes for ${socket.id}`
        );
      }

      const success = await transcriptionService.sendAudio(audioBuffer);

      if (!success) {
        console.warn(`⚠️ Failed to send audio for ${socket.id}`);
      }
    } catch (error) {
      console.error(
        `❌ Error processing audio-stream for ${socket.id}:`,
        error
      );
    }
  });

  socket.on("offer", (data) => {
    console.log(`📤 Forwarding offer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit("offer", {
      offer: data.offer,
      from: socket.id,
    });
  });

  socket.on("answer", (data) => {
    console.log(`📤 Forwarding answer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit("answer", {
      answer: data.answer,
      from: socket.id,
    });
  });

  socket.on("ice-candidate", (data) => {
    console.log(`🧊 Forwarding ICE candidate from ${socket.id} to ${data.to}`);
    io.to(data.to).emit("ice-candidate", {
      candidate: data.candidate,
      from: socket.id,
    });
  });

  socket.on("disconnect", async () => {
    console.log(`👋 User disconnected: ${socket.id}`);
    cwLogger.log("User Disconnected", { socketId: socket.id }); // ✅ ADD THIS LINE

    try {
      const transcriptionService = transcriptionPool.getConnection(socket.id);
      if (transcriptionService) {
        console.log(`🛑 Stopping transcription for ${socket.id}`);
        await transcriptionService.stop();
        transcriptionPool.removeConnection(socket.id);
      }

      rooms.forEach((users, roomId) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          console.log(`📤 Notifying room ${roomId} that ${socket.id} left`);
          socket.to(roomId).emit("user-left", socket.id);

          if (users.size === 0) {
            rooms.delete(roomId);
            console.log(`🧹 Cleaned up empty room: ${roomId}`);
          }
        }
      });
    } catch (error) {
      console.error(
        `❌ Error during disconnect cleanup for ${socket.id}:`,
        error
      );
    }
  });

  socket.on("error", (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  cwLogger.log("Server Shutdown", { reason: "SIGTERM" }); // ✅ ADD THIS LINE
  await transcriptionPool.cleanupAll();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down gracefully...");
  cwLogger.log("Server Shutdown", { reason: "SIGINT" }); // ✅ ADD THIS LINE
  await transcriptionPool.cleanupAll();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("\n==================================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("📡 WebSocket server ready");
  console.log(`🌍 Allowed origins: ${process.env.ALLOWED_ORIGINS || "*"}`);
  console.log(`🔑 AWS Region: ${process.env.AWS_REGION}`);
  console.log(`📊 Max concurrent transcriptions: 20`);
  console.log("==================================================\n");
});

module.exports = { app, server, io };
