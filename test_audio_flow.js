const io = require("socket.io-client");

const socket = io("http://localhost:3005", {
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("✅ Connected to server:", socket.id);

  // Join a test room
  socket.emit("join-room", "test-room");

  // Send fake audio data every second
  let count = 0;
  const interval = setInterval(() => {
    const fakeAudio = new Array(4096)
      .fill(0)
      .map(() => Math.floor(Math.random() * 65535) - 32768);
    socket.emit("audio-stream", {
      audio: fakeAudio,
      roomId: "test-room",
    });
    count++;
    console.log(`📤 Sent audio chunk ${count}`);

    if (count >= 30) {
      clearInterval(interval);
      socket.disconnect();
      console.log("✅ Test complete");
    }
  }, 500);
});

socket.on("disconnect", () => {
  console.log("❌ Disconnected");
});

socket.on("error", (err) => {
  console.error("❌ Socket error:", err);
});
