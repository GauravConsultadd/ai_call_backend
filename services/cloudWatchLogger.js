const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} = require("@aws-sdk/client-cloudwatch-logs");

class SimpleCloudWatchLogger {
  constructor() {
    this.logGroupName = "/aws/transcribe/streaming/app";
    this.logStreamName = `session-${Date.now()}`;
    this.enabled = false;
    this.client = null;
    this.sequenceToken = null;
  }

  async initialize() {
    try {
      if (
        !process.env.AWS_ACCESS_KEY_ID ||
        !process.env.AWS_SECRET_ACCESS_KEY
      ) {
        console.log("⚠️  CloudWatch logging disabled (no AWS credentials)");
        return false;
      }

      this.client = new CloudWatchLogsClient({
        region: process.env.AWS_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      // Create log group
      try {
        await this.client.send(
          new CreateLogGroupCommand({ logGroupName: this.logGroupName })
        );
        console.log(`✅ Created CloudWatch log group: ${this.logGroupName}`);
      } catch (err) {
        if (err.name !== "ResourceAlreadyExistsException") throw err;
      }

      // Create log stream
      try {
        await this.client.send(
          new CreateLogStreamCommand({
            logGroupName: this.logGroupName,
            logStreamName: this.logStreamName,
          })
        );
        console.log(`✅ Created CloudWatch log stream: ${this.logStreamName}`);
      } catch (err) {
        if (err.name !== "ResourceAlreadyExistsException") throw err;
      }

      this.enabled = true;
      console.log("✅ CloudWatch logging enabled");
      return true;
    } catch (error) {
      console.error("❌ CloudWatch initialization failed:", error.message);
      this.enabled = false;
      return false;
    }
  }

  async log(message, data = {}) {
    if (!this.enabled) return;

    try {
      const logEvent = {
        message: JSON.stringify({
          timestamp: new Date().toISOString(),
          message,
          ...data,
        }),
        timestamp: Date.now(),
      };

      const command = new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
        logEvents: [logEvent],
        sequenceToken: this.sequenceToken,
      });

      const response = await this.client.send(command);
      this.sequenceToken = response.nextSequenceToken;
    } catch (error) {
      // Silently fail to not disrupt main app
      if (process.env.NODE_ENV === "development") {
        console.error("CloudWatch log failed:", error.message);
      }
    }
  }
}

// Singleton
let instance = null;
function getLogger() {
  if (!instance) {
    instance = new SimpleCloudWatchLogger();
  }
  return instance;
}

module.exports = { getLogger };
