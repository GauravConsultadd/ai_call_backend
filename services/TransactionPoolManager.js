class TranscriptionPoolManager {
  constructor(maxConnections = 20) {
    this.maxConnections = maxConnections;
    this.activeConnections = new Map();
  }

  canAddConnection() {
    return this.activeConnections.size < this.maxConnections;
  }

  addConnection(userId, service) {
    if (!this.canAddConnection()) {
      throw new Error(`Max connections (${this.maxConnections}) reached`);
    }
    this.activeConnections.set(userId, service);
    console.log(
      `📊 Active transcription connections: ${this.activeConnections.size}/${this.maxConnections}`
    );
  }

  removeConnection(userId) {
    const removed = this.activeConnections.delete(userId);
    if (removed) {
      console.log(
        `📊 Active transcription connections: ${this.activeConnections.size}/${this.maxConnections}`
      );
    }
    return removed;
  }

  getConnection(userId) {
    return this.activeConnections.get(userId);
  }

  getActiveCount() {
    return this.activeConnections.size;
  }

  async cleanupAll() {
    console.log(
      `🧹 Cleaning up ${this.activeConnections.size} transcription connections...`
    );

    for (const [userId, service] of this.activeConnections.entries()) {
      try {
        await service.stop();
        this.activeConnections.delete(userId);
      } catch (err) {
        console.error(`Error stopping service for ${userId}:`, err);
      }
    }

    console.log("✅ All transcription connections cleaned up");
  }
}

module.exports = { TranscriptionPoolManager };
