const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { TranscriptionService } = require("./services/transcriptionService");
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
const transcriptionServices = new Map();

io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  socket.on("join-room", async (roomId) => {
    try {
      if (!roomId || typeof roomId !== "string") {
        console.error("Invalid room ID");
        return;
      }

      await socket.join(roomId);
      roomManager.addUser(roomId, socket.id);

      const existingUsers = roomManager.getUsers(roomId).filter((id) => id !== socket.id);
      socket.emit("existing-users", existingUsers);

      socket.to(roomId).emit("user-joined", socket.id);
      console.log(`👥 User ${socket.id} joined room: ${roomId}`);

      // Initialize transcription service for this user
      const transcriptionService = new TranscriptionService(roomId, socket.id);
      await transcriptionService.start((transcript) => {
        io.to(roomId).emit("transcript", {
          text: transcript,
          speaker: socket.id,
          timestamp: new Date().toISOString(),
        });
      });

      transcriptionServices.set(socket.id, transcriptionService);
    } catch (error) {
      console.error("Error joining room:", error);
    }
  });

  socket.on("audio-stream", async ({ audio, roomId }) => {
    try {
      if (!audio || !roomId) return;

      const transcriptionService = transcriptionServices.get(socket.id);
      if (transcriptionService) {
        const audioBuffer = Buffer.from(audio);
        await transcriptionService.sendAudio(audioBuffer);
      }
    } catch (error) {
      console.error("Error processing audio stream:", error);
    }
  });

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
    console.log(`❌ User disconnected: ${socket.id}`);

    const transcriptionService = transcriptionServices.get(socket.id);
    if (transcriptionService) {
      await transcriptionService.stop();
      transcriptionServices.delete(socket.id);
    }

    const rooms = roomManager.getUserRooms(socket.id);
    rooms.forEach((roomId) => {
      roomManager.removeUser(roomId, socket.id);
      socket.to(roomId).emit("user-left", socket.id);
    });
  });
});

const PORT = config.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});