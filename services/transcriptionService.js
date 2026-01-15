const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const { PassThrough } = require("stream");
const config = require("../config");

class TranscriptionService {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.client = null;
    this.audioStream = null;
    this.transcriptCallback = null;
    this.isActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.streamTimeout = null;
  }

  /**
   * Initialize and start the transcription service
   * @param {Function} onTranscript - Callback function for transcription results
   */
  async start(onTranscript) {
    try {
      this.transcriptCallback = onTranscript;
      this.reconnectAttempts = 0;

      // Initialize AWS Transcribe client
      this.client = new TranscribeStreamingClient({
        region: config.AWS_REGION,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });

      // Create audio stream
      this.audioStream = new PassThrough();

      // Configure transcription parameters
      const params = {
        LanguageCode: config.TRANSCRIBE_LANGUAGE_CODE,
        MediaEncoding: "pcm",
        MediaSampleRateHertz: config.SAMPLE_RATE,
        AudioStream: this.getAudioStream(),
        EnablePartialResultsStabilization: true,
        PartialResultsStability: "high",
      };

      // Start transcription
      const command = new StartStreamTranscriptionCommand(params);
      const response = await this.client.send(command);

      this.isActive = true;

      // Process transcription events
      this.processTranscriptionEvents(response.TranscriptResultStream);

      // Set timeout for stream inactivity
      this.resetStreamTimeout();
    } catch (error) {
      console.error(`❌ Error starting transcription for user ${this.userId}:`, error.message);
      await this.handleTranscriptionError(error);
    }
  }

  /**
   * Generator function to stream audio chunks to AWS
   */
  async *getAudioStream() {
    try {
      for await (const chunk of this.audioStream) {
        if (chunk && chunk.length > 0) {
          this.resetStreamTimeout();
          yield { AudioEvent: { AudioChunk: chunk } };
        }
      }
    } catch (error) {
      console.error(`❌ Audio stream error for user ${this.userId}:`, error.message);
    }
  }

  /**
   * Process transcription events from AWS Transcribe
   * @param {AsyncIterable} transcriptStream - Stream of transcription events
   */
  async processTranscriptionEvents(transcriptStream) {
    try {
      for await (const event of transcriptStream) {
        if (!this.isActive) break;

        if (event.TranscriptEvent) {
          const { Transcript } = event.TranscriptEvent;

          if (Transcript && Transcript.Results) {
            for (const result of Transcript.Results) {
              // Only process final results to avoid duplicate transcripts
              if (result.IsPartial === false) {
                const alternatives = result.Alternatives || [];
                
                if (alternatives.length > 0) {
                  const transcript = alternatives[0].Transcript;
                  
                  if (transcript && transcript.trim().length > 0) {
                    console.log(`📝 [${this.userId}] Transcript: "${transcript}"`);
                    
                    if (this.transcriptCallback) {
                      this.transcriptCallback(transcript.trim());
                    }
                  }
                }
              }
            }
          }
        }

        // Handle other event types if needed
        if (event.BadRequestException) {
          console.error(`❌ BadRequestException for user ${this.userId}:`, event.BadRequestException);
          await this.stop();
        }

        if (event.LimitExceededException) {
          console.error(`❌ LimitExceededException for user ${this.userId}:`, event.LimitExceededException);
          await this.stop();
        }

        if (event.InternalFailureException) {
          console.error(`❌ InternalFailureException for user ${this.userId}:`, event.InternalFailureException);
          await this.handleTranscriptionError(new Error("Internal AWS failure"));
        }
      }
    } catch (error) {
      if (error.name !== "TimeoutError") {
        console.error(`❌ Error processing transcription events for user ${this.userId}:`, error.message);
        await this.handleTranscriptionError(error);
      }
    } finally {
      console.log(`⏹️ Transcription stream ended for user ${this.userId}`);
    }
  }

  /**
   * Send audio data to the transcription stream
   * @param {Buffer} audioBuffer - Audio data in PCM format
   */
  async sendAudio(audioBuffer) {
    if (!this.isActive) {
      console.warn(`⚠️ Attempted to send audio for inactive transcription: ${this.userId}`);
      return;
    }

    if (!this.audioStream || this.audioStream.destroyed) {
      console.error(`❌ Audio stream is not available for user ${this.userId}`);
      await this.reconnect();
      return;
    }

    try {
      // Validate audio buffer
      if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        console.warn(`⚠️ Invalid audio buffer received for user ${this.userId}`);
        return;
      }

      // Write audio data to stream
      const canWrite = this.audioStream.write(audioBuffer);
      
      if (!canWrite) {
        // Backpressure handling
        await new Promise((resolve) => this.audioStream.once("drain", resolve));
      }
    } catch (error) {
      console.error(`❌ Error sending audio for user ${this.userId}:`, error.message);
      await this.handleTranscriptionError(error);
    }
  }

  /**
   * Reset the stream timeout to detect inactive streams
   */
  resetStreamTimeout() {
    if (this.streamTimeout) {
      clearTimeout(this.streamTimeout);
    }

    // Set 30-second timeout for stream inactivity
    this.streamTimeout = setTimeout(() => {
      console.log(`⏰ Stream timeout for user ${this.userId}, attempting reconnect...`);
      this.reconnect();
    }, 30000);
  }

  /**
   * Handle transcription errors with retry logic
   * @param {Error} error - The error that occurred
   */
  async handleTranscriptionError(error) {
    console.error(`❌ Transcription error for user ${this.userId}:`, error.message);

    if (this.reconnectAttempts < this.maxReconnectAttempts && this.isActive) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      await this.reconnect();
    } else {
      console.error(`❌ Max reconnection attempts reached for user ${this.userId}. Stopping transcription.`);
      await this.stop();
    }
  }

  /**
   * Reconnect the transcription service
   */
  async reconnect() {
    console.log(`🔄 Reconnecting transcription for user ${this.userId}...`);
    
    try {
      await this.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before reconnecting
      
      if (this.transcriptCallback) {
        await this.start(this.transcriptCallback);
      }
    } catch (error) {
      console.error(`❌ Reconnection failed for user ${this.userId}:`, error.message);
    }
  }

  /**
   * Stop the transcription service and cleanup resources
   */
  async stop() {
    try {
      this.isActive = false;

      // Clear timeout
      if (this.streamTimeout) {
        clearTimeout(this.streamTimeout);
        this.streamTimeout = null;
      }

      // Close audio stream
      if (this.audioStream && !this.audioStream.destroyed) {
        this.audioStream.end();
        this.audioStream.destroy();
      }

      // Cleanup references
      this.client = null;
      this.audioStream = null;
      this.transcriptCallback = null;

      console.log(`⏹️ Transcription stopped for user: ${this.userId} in room: ${this.roomId}`);
    } catch (error) {
      console.error(`❌ Error stopping transcription for user ${this.userId}:`, error.message);
    }
  }

  /**
   * Get the current status of the transcription service
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      userId: this.userId,
      roomId: this.roomId,
      isActive: this.isActive,
      reconnectAttempts: this.reconnectAttempts,
      hasAudioStream: this.audioStream && !this.audioStream.destroyed,
    };
  }
}

module.exports = { TranscriptionService };