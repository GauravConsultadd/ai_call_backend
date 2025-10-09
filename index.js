const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    // Get existing users before adding new user
    const existingUsers = Array.from(rooms.get(roomId));
    
    // Add new user to room
    rooms.get(roomId).add(socket.id);

    console.log(`📞 User ${socket.id} joined room ${roomId}`);
    console.log(`👥 Room ${roomId} now has ${rooms.get(roomId).size} users:`, Array.from(rooms.get(roomId)));

    // If there are existing users, notify the new user
    if (existingUsers.length > 0) {
      console.log(`📤 Sending existing users to ${socket.id}:`, existingUsers);
      socket.emit('existing-users', existingUsers);
    }

    // Notify existing users about the new user
    socket.to(roomId).emit('user-joined', socket.id);
    console.log(`📢 Notified room ${roomId} about new user ${socket.id}`);
  });

  socket.on('offer', (data) => {
    console.log(`📨 Offer: ${socket.id} → ${data.to}`);
    io.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log(`📨 Answer: ${socket.id} → ${data.to}`);
    io.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log(`🧊 ICE candidate: ${socket.id} → ${data.to}`);
    io.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on('transcript', (data) => {
    console.log(`📝 Transcript from ${socket.id} in room ${data.roomId}: "${data.text}"`);
    socket.to(data.roomId).emit('transcript', {
      text: data.text,
      speaker: data.speaker,
      timestamp: data.timestamp
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit('user-left', socket.id);
        console.log(`👋 User ${socket.id} left room ${roomId}`);
        
        if (users.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️ Room ${roomId} deleted (empty)`);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});