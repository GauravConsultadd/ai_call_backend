class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.userRooms = new Map();
  }

  addUser(roomId, userId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(userId);

    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId).add(roomId);

    console.log(`➕ Added user ${userId} to room ${roomId}`);
  }

  removeUser(roomId, userId) {
    if (this.rooms.has(roomId)) {
      this.rooms.get(roomId).delete(userId);

      if (this.rooms.get(roomId).size === 0) {
        this.rooms.delete(roomId);
        console.log(`🗑️ Deleted empty room: ${roomId}`);
      }
    }

    if (this.userRooms.has(userId)) {
      this.userRooms.get(userId).delete(roomId);

      if (this.userRooms.get(userId).size === 0) {
        this.userRooms.delete(userId);
      }
    }

    console.log(`➖ Removed user ${userId} from room ${roomId}`);
  }

  getUsers(roomId) {
    if (!this.rooms.has(roomId)) {
      return [];
    }
    return Array.from(this.rooms.get(roomId));
  }

  getUserRooms(userId) {
    if (!this.userRooms.has(userId)) {
      return [];
    }
    return Array.from(this.userRooms.get(userId));
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getUserCount(roomId) {
    if (!this.rooms.has(roomId)) {
      return 0;
    }
    return this.rooms.get(roomId).size;
  }

  getAllRooms() {
    return Array.from(this.rooms.keys());
  }

  isUserInRoom(roomId, userId) {
    return this.rooms.has(roomId) && this.rooms.get(roomId).has(userId);
  }
}

module.exports = { RoomManager };