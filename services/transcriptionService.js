const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");
const awsConfig = require("../config/aws");

class TranscriptionService {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.transcribeClient = null;
    this.audioStream = null;
    this.isActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.streamStartTime = null;
    this.maxStreamDuration = 4 * 60 * 60 * 1000;
    this.inactivityTimeout = null;
    this.maxInactivityTime = 30000;
    this.lastAudioTime = null;
    this.audioChunksReceived = 0; // Track audio chunks

    console.log(
      `🎙️ TranscriptionService instance created for user ${userId} in room ${roomId}`
    );
  }

  async start(onTranscript) {
    console.log("Start function called");
    console.log(`🚀 Starting transcription service for user ${this.userId}`);

    try {
      if (!awsConfig.isValid) {
        throw new Error("AWS credentials are not configured properly");
      }

      if (
        !awsConfig.credentials.accessKeyId ||
        !awsConfig.credentials.secretAccessKey
      ) {
        throw new Error(
          "AWS credentials are missing. Please check your .env file."
        );
      }

      console.log(
        `🔐 Creating Transcribe client with region: ${awsConfig.region}`
      );

      this.transcribeClient = new TranscribeStreamingClient({
        region: awsConfig.region,
        credentials: awsConfig.credentials,
      });

      console.log(`✅ Transcribe client created for user ${this.userId}`);

      this.isActive = true;
      this.reconnectAttempts = 0;
      this.streamStartTime = Date.now();

      await this.initializeStream(onTranscript);

      this.startInactivityMonitor();

      console.log(
        `✅ Transcription service fully initialized for user ${this.userId}`
      );
    } catch (error) {
      console.error(
        `❌ Error starting transcription for user ${this.userId}:`,
        error.message
      );

      if (error.name === "LimitExceededException") {
        console.error("❌ AWS Transcribe concurrent stream limit reached!");
      } else if (error.name === "UnrecognizedClientException") {
        console.error("❌ Invalid AWS credentials");
      }

      this.isActive = false;
      throw error;
    }
  }

  startInactivityMonitor() {
    console.log("Starting inactivity monitor");
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    this.inactivityTimeout = setTimeout(() => {
      const timeSinceLastAudio =
        Date.now() - (this.lastAudioTime || this.streamStartTime);

      if (timeSinceLastAudio > this.maxInactivityTime) {
        console.log(
          `⏱️ Stream inactive for ${timeSinceLastAudio}ms, stopping transcription for user ${this.userId}`
        );
        this.stop();
      }
    }, this.maxInactivityTime);
  }

  async initializeStream(onTranscript) {
    console.log("initializeStream called");
    if (!this.isActive) return;

    try {
      if (this.audioStream && !this.audioStream.destroyed) {
        this.audioStream.destroy();
      }

      this.audioStream = new PassThrough({ highWaterMark: 1024 * 16 });

      this.audioStream.on("error", (err) => {
        console.error(`❌ Audio stream error for user ${this.userId}:`, err);
      });

      const audioStream = async function* (stream) {
        try {
          for await (const chunk of stream) {
            yield { AudioEvent: { AudioChunk: chunk } };
          }
        } catch (err) {
          console.error("❌ Error in audio stream generator:", err);
        }
      };

      const command = new StartStreamTranscriptionCommand({
        LanguageCode: awsConfig.transcribe.languageCode,
        MediaSampleRateHertz: awsConfig.transcribe.mediaSampleRateHertz,
        MediaEncoding: awsConfig.transcribe.mediaEncoding,
        AudioStream: audioStream(this.audioStream),
        EnablePartialResultsStabilization: true,
        PartialResultsStability: "high",
        // Add session ID for tracking
        // SessionId: `session-${this.userId}-${Date.now()}`,
      });

      console.log(
        `🔄 Sending StartStreamTranscription command for user ${this.userId}`
      );

      const startTime = Date.now();
      const response = await this.transcribeClient.send(command);
      const endTime = Date.now();

      // ✅ LOG AWS METADATA
      console.log(`\n${"=".repeat(60)}`);
      console.log(`✅ AWS TRANSCRIBE CONNECTION ESTABLISHED`);
      console.log(`${"=".repeat(60)}`);
      console.log(`👤 User ID: ${this.userId}`);
      console.log(`🔑 Session ID: session-${this.userId}-${Date.now()}`);
      console.log(`📍 AWS Region: ${awsConfig.region}`);
      console.log(`⏱️  Connection Time: ${endTime - startTime}ms`);
      console.log(`🎤 Language: ${awsConfig.transcribe.languageCode}`);
      console.log(
        `📊 Sample Rate: ${awsConfig.transcribe.mediaSampleRateHertz}Hz`
      );
      console.log(`🎵 Encoding: ${awsConfig.transcribe.mediaEncoding}`);

      // Log response metadata if available
      if (response.$metadata) {
        console.log(`\n📋 AWS Response Metadata:`);
        console.log(`   Request ID: ${response.$metadata.requestId || "N/A"}`);
        console.log(
          `   HTTP Status: ${response.$metadata.httpStatusCode || "N/A"}`
        );
        console.log(`   Attempts: ${response.$metadata.attempts || 1}`);
        console.log(
          `   Total Time: ${response.$metadata.totalRetryDelay || 0}ms`
        );
      }
      console.log(`${"=".repeat(60)}\n`);

      this.reconnectAttempts = 0;

      await this.handleTranscriptStream(
        response.TranscriptResultStream,
        onTranscript
      );
    } catch (error) {
      console.error(
        `❌ Transcription stream error for user ${this.userId}:`,
        error.message,
        error.stack
      );

      // Log AWS error details
      if (error.$metadata) {
        console.error(`\n🔴 AWS ERROR METADATA:`);
        console.error(`   Request ID: ${error.$metadata.requestId}`);
        console.error(`   HTTP Status: ${error.$metadata.httpStatusCode}`);
        console.error(`   Service: ${error.name}`);
      }

      if (
        error.name === "LimitExceededException" ||
        error.name === "UnrecognizedClientException" ||
        error.$metadata?.httpStatusCode === 403 ||
        error.$metadata?.httpStatusCode === 429
      ) {
        console.error(`❌ Fatal error (${error.name}). Not retrying.`);
        this.isActive = false;
        return;
      }

      await this.handleStreamError(onTranscript);
    }
  }

  async handleTranscriptStream(transcriptStream, onTranscript) {
    console.log("handleTranscriptStream called");
    console.log(`📡 Starting to listen for transcript events...`);

    let transcriptCount = 0;
    let partialCount = 0;
    let finalCount = 0;

    try {
      for await (const event of transcriptStream) {
        if (!this.isActive) {
          console.log(`⏹️ Stopping transcript processing (inactive)`);
          break;
        }

        transcriptCount++;

        // Log event details
        if (transcriptCount === 1) {
          console.log(`\n🎉 FIRST TRANSCRIPT EVENT RECEIVED FROM AWS`);
          console.log(`   This confirms AWS Transcribe is working!`);
        }

        if (event.TranscriptEvent?.Transcript?.Results) {
          const results = event.TranscriptEvent.Transcript.Results;

          for (const result of results) {
            if (result.IsPartial) {
              partialCount++;
            } else {
              finalCount++;
            }

            // Log stats every 10 transcripts
            if ((finalCount + partialCount) % 10 === 0) {
              console.log(`\n📊 AWS TRANSCRIBE STATS:`);
              console.log(`   Total Events: ${transcriptCount}`);
              console.log(`   Partial Results: ${partialCount}`);
              console.log(`   Final Results: ${finalCount}`);
              console.log(`   User: ${this.userId}`);
            }

            if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
              const transcript = result.Alternatives[0].Transcript.trim();

              if (transcript.length > 0) {
                console.log(`\n✅ AWS TRANSCRIBE OUTPUT:`);
                console.log(`   User: ${this.userId}`);
                console.log(`   Text: "${transcript}"`);
                console.log(
                  `   Confidence: ${result.Alternatives[0].Confidence || "N/A"}`
                );
                console.log(`   Timestamp: ${new Date().toISOString()}`);

                onTranscript(transcript);
              }
            }
          }
        }
      }

      console.log(`\n📭 Transcript stream ended for user ${this.userId}`);
      console.log(`   Total events received: ${transcriptCount}`);
      console.log(`   Partial results: ${partialCount}`);
      console.log(`   Final results: ${finalCount}`);

      if (this.isActive) {
        console.log(
          `🔄 Stream ended naturally, attempting to reconnect for user ${this.userId}`
        );
        await this.handleStreamError(onTranscript);
      }
    } catch (error) {
      console.error("❌ Error processing transcript stream:", error);

      if (
        error.name === "BadRequestException" &&
        error.message?.includes("no new audio")
      ) {
        console.log(
          `⏱️ Audio timeout for user ${this.userId} - restarting stream`
        );
        if (this.isActive) {
          await this.handleStreamError(onTranscript);
        }
      } else if (this.isActive) {
        await this.handleStreamError(onTranscript);
      }
    }
  }

  async handleStreamError(onTranscript) {
    console.log("handleStreamError called");
    if (!this.isActive || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `❌ Max reconnection attempts reached for user ${this.userId}`
      );
      this.isActive = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 5000);

    console.log(
      `🔄 Reconnecting transcription (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.initializeStream(onTranscript);
  }

  async sendAudio(audioBuffer) {
    console.log("sendAudio called");
    if (!this.isActive || !this.audioStream || this.audioStream.destroyed) {
      console.warn(
        `⚠️ Cannot send audio - stream not ready for ${this.userId}`
      );
      return false;
    }

    try {
      this.lastAudioTime = Date.now();
      this.audioChunksReceived++;

      // Log every 50 chunks
      if (this.audioChunksReceived % 50 === 0) {
        console.log(
          `📊 Sent ${this.audioChunksReceived} audio chunks for user ${this.userId}`
        );
      }

      this.startInactivityMonitor();

      const streamDuration = Date.now() - this.streamStartTime;
      if (streamDuration > this.maxStreamDuration) {
        console.log(
          `⏱️ Stream exceeded max duration, stopping for user ${this.userId}`
        );
        await this.stop();
        return false;
      }

      const canWrite = this.audioStream.write(audioBuffer);

      if (!canWrite) {
        await Promise.race([
          new Promise((resolve) => this.audioStream.once("drain", resolve)),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      }

      return true;
    } catch (error) {
      console.error("❌ Error sending audio to transcription stream:", error);
      return false;
    }
  }

  async stop() {
    console.log("stop called");
    console.log(`⏹️ Stopping transcription for user ${this.userId}`);
    this.isActive = false;

    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    if (this.audioStream && !this.audioStream.destroyed) {
      try {
        this.audioStream.end();
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!this.audioStream.destroyed) {
          this.audioStream.destroy();
        }
      } catch (error) {
        console.error("❌ Error ending audio stream:", error);
      }
    }

    if (this.transcribeClient) {
      try {
        this.transcribeClient.destroy();
      } catch (error) {
        console.error("❌ Error destroying transcribe client:", error);
      }
    }

    this.audioStream = null;
    this.transcribeClient = null;

    console.log(
      `✅ Transcription stopped and cleaned up for user ${this.userId}`
    );
  }
}

module.exports = { TranscriptionService };
