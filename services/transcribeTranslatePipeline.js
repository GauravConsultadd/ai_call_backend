const { TranscriptionService } = require("./transcriptionService");
const { TranslationService } = require("./translationService");
const { BedrockScamDetectionService } = require("./bedrockScamDetectionService");

/**
 * Enhanced Pipeline: Transcription → Translation → Bedrock Scam Analysis
 * Three-stage pipeline for real-time conversation monitoring and scam detection
 */
class TranscribeTranslatePipeline {
  constructor(roomId, userId, userRole = "user") {
    this.roomId = roomId;
    this.userId = userId;
    this.userRole = userRole; // "user" or "caller"
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
   * @param {Function} onPipelineOutput - Callback for complete pipeline output
   * @param {Object} options - Configuration options
   */
  async start(onPipelineOutput, options = {}) {
    try {
      this.pipelineCallback = onPipelineOutput;
      this.stats.startTime = new Date().toISOString();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚀 [PIPELINE] Starting Transcribe → Translate → Bedrock Pipeline`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   User ID: ${this.userId}`);
      console.log(`   User Role: ${this.userRole.toUpperCase()}`);
      console.log(`   Room ID: ${this.roomId}`);
      console.log(`   Target Language: ${options.targetLanguage || 'en'}`);
      console.log(`   Scam Detection: ENABLED`);
      console.log(`   Auto Language Detection: ${options.autoDetectLanguage !== false ? 'ENABLED' : 'DISABLED'}`);
      console.log(`${'='.repeat(80)}\n`);

      // Step 1: Initialize Bedrock Service with role
      console.log(`📍 [PIPELINE STEP 1/3] Initializing Bedrock Scam Detection Service...`);
      this.bedrockService = new BedrockScamDetectionService(this.roomId, this.userId, this.userRole);
      const bedrockStarted = await this.bedrockService.start();

      if (!bedrockStarted) {
        throw new Error("Failed to start Bedrock Service");
      }

      // Step 2: Initialize Translation Service
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

      // Step 3: Initialize Transcription Service
      console.log(`📍 [PIPELINE STEP 3/3] Initializing Transcription Service...`);
      this.transcriptionService = new TranscriptionService(this.roomId, this.userId);
      await this.transcriptionService.start(this.handleTranscriptionOutput.bind(this));

      this.isActive = true;

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ [PIPELINE] Successfully Started!`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   🎤 Transcription: ACTIVE`);
      console.log(`   🌐 Translation: ACTIVE`);
      console.log(`   🧠 Bedrock Scam Detection: ACTIVE`);
      console.log(`   📊 Pipeline: READY`);
      console.log(`${'='.repeat(80)}\n`);

      return true;
    } catch (error) {
      console.error(`\n❌ [PIPELINE] Failed to start:`, error.message);
      await this.stop();
      return false;
    }
  }

  /**
   * Handle transcription output and pass to translation
   * This is the first stage of the pipeline
   */
  async handleTranscriptionOutput(transcript) {
    try {
      this.stats.transcriptionsReceived++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🎤 [PIPELINE STAGE 1: TRANSCRIPTION] Output received`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`   Transcription #${this.stats.transcriptionsReceived}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Text: "${transcript}"`);
      console.log(`   Length: ${transcript.length} characters`);
      console.log(`   Timestamp: ${new Date().toISOString()}`);

      // Pass to next stage: Translation
      console.log(`\n🔄 [PIPELINE] Passing to Translation Service...`);

      if (this.translationService && this.translationService.isActive) {
        // Translate the transcribed text
        await this.translationService.translateText(transcript, this.detectedLanguage);
      } else {
        console.error(`❌ [PIPELINE] Translation service not active`);
        this.stats.errors++;
      }

    } catch (error) {
      console.error(`\n❌ [PIPELINE STAGE 1] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle translation output and pass to Bedrock analysis
   * This is the second stage of the pipeline
   */
  async handleTranslationOutput(translationResult) {
    try {
      this.stats.translationsCompleted++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🌐 [PIPELINE STAGE 2: TRANSLATION] Output received`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`   Translation #${this.stats.translationsCompleted}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Original: "${translationResult.originalText}"`);
      console.log(`   Translated: "${translationResult.translatedText}"`);
      console.log(`   Languages: ${translationResult.sourceLanguage} → ${translationResult.targetLanguage}`);
      console.log(`   Duration: ${translationResult.duration}ms`);

      // Add to Bedrock conversation history
      if (this.bedrockService && this.bedrockService.isActive) {
        this.bedrockService.addToConversation(
          translationResult.originalText,
          translationResult.translatedText,
          this.userId
        );

        // Pass to next stage: Bedrock Analysis
        console.log(`\n🔄 [PIPELINE] Passing to Bedrock Scam Detection...`);

        const analysisResult = await this.bedrockService.analyzeConversation(
          translationResult.translatedText
        );

        if (analysisResult) {
          this.handleBedrockAnalysisOutput(translationResult, analysisResult);
        } else {
          console.error(`❌ [PIPELINE] Bedrock analysis returned null`);
          // Still emit translation without analysis
          this.emitPipelineOutput(translationResult, null);
        }
      } else {
        console.error(`❌ [PIPELINE] Bedrock service not active`);
        // Emit without analysis
        this.emitPipelineOutput(translationResult, null);
      }

    } catch (error) {
      console.error(`\n❌ [PIPELINE STAGE 2] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle Bedrock analysis output - final stage of pipeline
   */
  handleBedrockAnalysisOutput(translationResult, analysisResult) {
    try {
      this.stats.analysesCompleted++;
      this.stats.lastActivityTime = new Date().toISOString();

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🧠 [PIPELINE STAGE 3: BEDROCK ANALYSIS] Output received`);
      console.log(`${'─'.repeat(80)}`);
      console.log(`   Analysis #${this.stats.analysesCompleted}`);
      console.log(`   User: ${this.userId}`);
      console.log(`   Summary: "${analysisResult.summary}"`);
      console.log(`   Risk Level: ${analysisResult.riskLevel}`);
      console.log(`   Scam Probability: ${analysisResult.scamProbability}%`);
      console.log(`   Concerns: ${analysisResult.concerns.join(', ') || 'None'}`);
      console.log(`   Duration: ${analysisResult.duration}ms`);

      // Emit complete pipeline output
      this.emitPipelineOutput(translationResult, analysisResult);

    } catch (error) {
      console.error(`\n❌ [PIPELINE STAGE 3] Error:`, error.message);
      this.stats.errors++;
    }
  }

  /**
   * Emit complete pipeline output to callback
   */
  emitPipelineOutput(translationResult, analysisResult) {
    console.log(`\n✅ [PIPELINE] Complete output ready`);
    console.log(`${'─'.repeat(80)}\n`);

    // Trigger final callback with complete pipeline result
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
        scamAnalysis: analysisResult ? {
          summary: analysisResult.summary,
          scamProbability: analysisResult.scamProbability,
          riskLevel: analysisResult.riskLevel,
          concerns: analysisResult.concerns,
          reasoning: analysisResult.reasoning,
        } : null,
        detectedLanguage: translationResult.detectedLanguage,
        timestamp: translationResult.timestamp,
        pipelineStats: {
          stage1Duration: 0, // Transcription duration (not tracked separately)
          stage2Duration: translationResult.duration,
          stage3Duration: analysisResult ? analysisResult.duration : 0,
          totalProcessed: this.stats.analysesCompleted,
        },
      };

      this.pipelineCallback(pipelineOutput);
    }
  }

  /**
   * Send audio data to the pipeline
   * @param {Buffer} audioBuffer - Audio data in PCM format
   */
  async sendAudio(audioBuffer) {
    if (!this.isActive || !this.transcriptionService) {
      console.warn(`⚠️  [PIPELINE] Not active for user ${this.userId}`);
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
   * Change translation target language
   * @param {string} targetLanguage - Target language code
   */
  setTargetLanguage(targetLanguage) {
    if (this.translationService) {
      console.log(`\n🔄 [PIPELINE] Changing target language to: ${targetLanguage}`);
      this.translationService.setLanguages(
        this.translationService.sourceLanguage,
        targetLanguage
      );
    }
  }

  /**
   * Clear conversation history in Bedrock
   */
  clearConversationHistory() {
    if (this.bedrockService) {
      this.bedrockService.clearHistory();
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
        uptimeFormatted: this.formatDuration(uptime),
        successRate: this.stats.transcriptionsReceived > 0
          ? ((this.stats.analysesCompleted / this.stats.transcriptionsReceived) * 100).toFixed(2) + '%'
          : 'N/A',
      },
      services: {
        transcription: this.transcriptionService?.getStatus() || null,
        translation: this.translationService?.getStatus() || null,
        bedrock: this.bedrockService?.getStats() || null,
      },
    };
  }

  /**
   * Format duration in ms to human readable
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Print current pipeline statistics
   */
  printStats() {
    const stats = this.getStats();
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 [PIPELINE STATISTICS] User: ${this.userId}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   Status: ${stats.isActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
    console.log(`   Uptime: ${stats.stats.uptimeFormatted}`);
    console.log(`   Transcriptions Received: ${stats.stats.transcriptionsReceived}`);
    console.log(`   Translations Completed: ${stats.stats.translationsCompleted}`);
    console.log(`   Analyses Completed: ${stats.stats.analysesCompleted}`);
    console.log(`   Success Rate: ${stats.stats.successRate}`);
    console.log(`   Errors: ${stats.stats.errors}`);
    console.log(`   Last Activity: ${stats.stats.lastActivityTime || 'N/A'}`);
    
    if (stats.services.bedrock) {
      console.log(`\n   🧠 [Bedrock Statistics]`);
      console.log(`   Total Analyses: ${stats.services.bedrock.stats.totalAnalyses}`);
      console.log(`   High Risk Detections: ${stats.services.bedrock.stats.highRiskDetections}`);
      console.log(`   Medium Risk Detections: ${stats.services.bedrock.stats.mediumRiskDetections}`);
      console.log(`   Low Risk Detections: ${stats.services.bedrock.stats.lowRiskDetections}`);
      console.log(`   Average Risk Score: ${stats.services.bedrock.stats.averageRiskScore}%`);
    }
    
    console.log(`${'='.repeat(80)}\n`);
  }

  /**
   * Register a speaker with their role in the Bedrock service
   * @param {string} socketId - Speaker's socket ID
   * @param {string} role - "user" or "caller"
   */
  registerSpeaker(socketId, role) {
    if (this.bedrockService) {
      this.bedrockService.registerSpeaker(socketId, role);
      console.log(`👤 [PIPELINE] Registered speaker ${socketId} as ${role.toUpperCase()}`);
    }
  }

  /**
   * Stop the pipeline and cleanup all services
   */
  async stop() {
    try {
      this.isActive = false;

      console.log(`\n${'='.repeat(80)}`);
      console.log(`⏹️  [PIPELINE] Stopping for user: ${this.userId}`);
      console.log(`${'='.repeat(80)}`);

      // Print final statistics
      this.printStats();

      console.log(`🔄 [PIPELINE] Cleaning up services...`);

      if (this.transcriptionService) {
        await this.transcriptionService.stop();
        this.transcriptionService = null;
        console.log(`   ✅ Transcription Service stopped`);
      }

      if (this.translationService) {
        await this.translationService.stop();
        this.translationService = null;
        console.log(`   ✅ Translation Service stopped`);
      }

      if (this.bedrockService) {
        await this.bedrockService.stop();
        this.bedrockService = null;
        console.log(`   ✅ Bedrock Service stopped`);
      }

      this.pipelineCallback = null;

      console.log(`\n✅ [PIPELINE] Successfully stopped`);
      console.log(`${'='.repeat(80)}\n`);

    } catch (error) {
      console.error(`\n❌ [PIPELINE] Error stopping:`, error.message);
    }
  }
}

module.exports = { TranscribeTranslatePipeline };