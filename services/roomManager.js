class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  addUser(roomId, userId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(userId);
    console.log(`✅ User ${userId} added to room ${roomId}`);
  }

  removeUser(roomId, userId) {
    if (this.rooms.has(roomId)) {
      this.rooms.get(roomId).delete(userId);

      if (this.rooms.get(roomId).size === 0) {
        this.rooms.delete(roomId);
        console.log(`🗑️ Room ${roomId} deleted (no users left)`);
      } else {
        console.log(`👋 User ${userId} removed from room ${roomId}`);
      }
    }
  }

  getUsers(roomId) {
    return this.rooms.has(roomId) ? Array.from(this.rooms.get(roomId)) : [];
  }

  getUserRooms(userId) {
    const userRooms = [];
    for (const [roomId, users] of this.rooms.entries()) {
      if (users.has(userId)) {
        userRooms.push(roomId);
      }
    }
    return userRooms;
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getUserCount(roomId) {
    return this.rooms.has(roomId) ? this.rooms.get(roomId).size : 0;
  }
}

module.exports = { RoomManager };
