const { TranscriptionService } = require("./transcriptionService");
const { TranslationService } = require("./translationService");
const { BedrockScamDetectionService } = require("./bedrockScamDetectionService");

/**
 * Simplified Pipeline: Transcription → Translation → Bedrock Fraud Analysis
 * Analyzes ALL participants equally for fraud detection
 */
class TranscribeTranslatePipeline {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.transcriptionService = null;
    this.translationService = null;
    this.bedrockService = null;
    this.isActive = false;
    this.pipelineCallback = null;
    this.detectedLanguage = null;
    
    // Pipeline statistics
    this.stats = {
      transcriptionsReceived: 0,
      translationsCompleted: 0,
      analysesCompleted: 0,
      errors: 0,
      startTime: null,
      lastActivityTime: null,
    };
  }

  /**
   * Start the pipeline with all three services
   */
  async start(onPipelineOutput, options = {}) {
    try {
      this.pipelineCallback = onPipelineOutput;
      this.stats.startTime = new Date().toISOString();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚀 [PIPELINE] Starting Transcribe → Translate → Bedrock Pipeline`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   User ID: ${this.userId}`);
      console.log(`   Room ID: ${this.roomId}`);
      console.log(`   Fraud Detection: ENABLED (All participants)`);
      console.log(`${'='.repeat(80)}\n`);

      // Initialize Bedrock Service
      console.log(`📍 [PIPELINE STEP 1/3] Initializing Bedrock Fraud Detection...`);
      this.bedrockService = new BedrockScamDetectionService(this.roomId, this.userId);
      const bedrockStarted = await this.bedrockService.start();

      if (!bedrockStarted) {
        throw new Error("Failed to start Bedrock Service");
      }

      // Initialize Translation Service
      console.log(`📍 [PIPELINE STEP 2/3] Initializing Translation Service...`);
      this.translationService = new TranslationService(this.roomId, this.userId);
      const translationStarted = await this.translationService.start(
        this.handleTranslationOutput.bind(this),
        {
          sourceLanguage: options.sourceLanguage || "hi",
          targetLanguage: options.targetLanguage || "en",
        }
      );

      if (!translationStarted) {
        throw new Error("Failed to start Translation Service");
      }

      // Initialize Transcription Service
      console.log(`📍 [PIPELINE STEP 3/3] Initializing Transcription Service...`);
      this.transcriptionService = new TranscriptionService(this.roomId, this.userId);
      await this.transcriptionService.start(this.handleTranscriptionOutput.bind(this));

      this.isActive = true;

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ [PIPELINE] Successfully Started!`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   🎤 Transcription: ACTIVE`);
      console.log(`   🌐 Translation: ACTIVE`);
      console.log(`   🧠 Bedrock Fraud Detection: ACTIVE`);
      console.log(`${'='.repeat(80)}\n`);

      return true;
    } catch (error) {
      console.error(`\n❌ [PIPELINE] Failed to start:`, error.message);
      await this.stop();
      return false;
    }
  }

  /**
   * Handle transcription output
   */
  async handleTranscriptionOutput(transcript) {
    try {
      this.stats.transcriptionsReceived++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n🎤 [STAGE 1: TRANSCRIPTION] #${this.stats.transcriptionsReceived}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Text: "${transcript}"`);

      if (this.translationService && this.translationService.isActive) {
        await this.translationService.translateText(transcript, this.detectedLanguage);
      } else {
        console.error(`❌ Translation service not active`);
        this.stats.errors++;
      }

    } catch (error) {
      console.error(`\n❌ [STAGE 1] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle translation output and pass to Bedrock
   */
  async handleTranslationOutput(translationResult) {
    try {
      this.stats.translationsCompleted++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n🌐 [STAGE 2: TRANSLATION] #${this.stats.translationsCompleted}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Original: "${translationResult.originalText}"`);
      console.log(`   Translated: "${translationResult.translatedText}"`);

      // Add to conversation history
      if (this.bedrockService && this.bedrockService.isActive) {
        this.bedrockService.addToConversation(
          translationResult.translatedText,
          this.userId
        );

        // Analyze for fraud (analyzes everyone equally)
        console.log(`\n🔄 [PIPELINE] Passing to Bedrock Fraud Detection...`);

        const analysisResult = await this.bedrockService.analyzeConversation(
          translationResult.translatedText,
          this.userId
        );

        if (analysisResult) {
          this.handleBedrockAnalysisOutput(translationResult, analysisResult);
        } else {
          // Emit without analysis
          this.emitPipelineOutput(translationResult, null);
        }
      } else {
        console.error(`❌ Bedrock service not active`);
        this.emitPipelineOutput(translationResult, null);
      }

    } catch (error) {
      console.error(`\n❌ [STAGE 2] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle Bedrock analysis output
   */
  handleBedrockAnalysisOutput(translationResult, analysisResult) {
    try {
      this.stats.analysesCompleted++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n🧠 [STAGE 3: FRAUD ANALYSIS] #${this.stats.analysesCompleted}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Fraud Score: ${analysisResult.fraudScore}%`);
      console.log(`   Risk Level: ${analysisResult.riskLevel}`);

      this.emitPipelineOutput(translationResult, analysisResult);

    } catch (error) {
      console.error(`\n❌ [STAGE 3] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Emit complete pipeline output
   */
  emitPipelineOutput(translationResult, analysisResult) {
    console.log(`\n✅ [PIPELINE] Complete output ready\n`);

    if (this.pipelineCallback) {
      const pipelineOutput = {
        userId: this.userId,
        roomId: this.roomId,
        transcription: {
          text: translationResult.originalText,
          language: translationResult.sourceLanguage,
        },
        translation: {
          text: translationResult.translatedText,
          language: translationResult.targetLanguage,
        },
        fraudAnalysis: analysisResult ? {
          summary: analysisResult.summary,
          fraudScore: analysisResult.fraudScore,
          riskLevel: analysisResult.riskLevel,
          redFlags: analysisResult.redFlags,
          reasoning: analysisResult.reasoning,
          matchedPatterns: analysisResult.matchedPatterns,
        } : null,
        timestamp: translationResult.timestamp,
      };

      this.pipelineCallback(pipelineOutput);
    }
  }

  /**
   * Send audio data to the pipeline
   */
  async sendAudio(audioBuffer) {
    if (!this.isActive || !this.transcriptionService) {
      return;
    }

    try {
      await this.transcriptionService.sendAudio(audioBuffer);
    } catch (error) {
      console.error(`❌ [PIPELINE] Error sending audio:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    const uptime = this.stats.startTime 
      ? Date.now() - new Date(this.stats.startTime).getTime()
      : 0;

    return {
      userId: this.userId,
      roomId: this.roomId,
      isActive: this.isActive,
      stats: {
        ...this.stats,
        uptime: uptime,
      },
      services: {
        transcription: this.transcriptionService?.getStatus() || null,
        translation: this.translationService?.getStatus() || null,
        bedrock: this.bedrockService?.getStats() || null,
      },
    };
  }

  /**
   * Stop the pipeline
   */
  async stop() {
    try {
      this.isActive = false;

      if (this.transcriptionService) {
        await this.transcriptionService.stop();
        this.transcriptionService = null;
      }

      if (this.translationService) {
        await this.translationService.stop();
        this.translationService = null;
      }

      if (this.bedrockService) {
        await this.bedrockService.stop();
        this.bedrockService = null;
      }

      this.pipelineCallback = null;

      console.log(`\n✅ [PIPELINE] Stopped\n`);

    } catch (error) {
      console.error(`\n❌ [PIPELINE] Error stopping:`, error.message);
    }
  }
}

module.exports = { TranscribeTranslatePipeline };