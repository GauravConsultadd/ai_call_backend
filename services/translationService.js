const {
  TranslateClient,
  TranslateTextCommand,
} = require("@aws-sdk/client-translate");
const config = require("../config");

class TranslationService {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.client = null;
    this.translationCallback = null;
    this.isActive = false;
    this.sourceLanguage = "hi"; // Hindi
    this.targetLanguage = "en"; // English
    this.lastTranslation = null;
    this.translationCount = 0;
  }

  /**
   * Initialize and start the translation service
   * @param {Function} onTranslation - Callback function for translation results
   * @param {Object} options - Optional configuration
   */
  async start(onTranslation, options = {}) {
    try {
      this.translationCallback = onTranslation;
      this.sourceLanguage = options.sourceLanguage || "hi";
      this.targetLanguage = options.targetLanguage || "en";

      console.log(`\n🌐 [Translation Service] Starting for user: ${this.userId}`);
      console.log(`   Room: ${this.roomId}`);
      console.log(`   Translation: ${this.sourceLanguage} → ${this.targetLanguage}`);
      console.log(`   AWS Region: ${config.AWS_REGION}`);

      // Initialize AWS Translate client
      this.client = new TranslateClient({
        region: config.AWS_REGION,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });

      this.isActive = true;
      console.log(`✅ [Translation Service] Initialized successfully for user: ${this.userId}\n`);

      return true;
    } catch (error) {
      console.error(`❌ [Translation Service] Error starting for user ${this.userId}:`, error.message);
      return false;
    }
  }

  /**
   * Translate text from source language to target language
   * @param {string} text - Text to translate
   * @param {string} detectedLanguage - Detected language from transcription (optional)
   * @returns {Promise<Object>} Translation result
   */
  async translateText(text, detectedLanguage = null) {
    if (!this.isActive) {
      console.warn(`⚠️  [Translation] Service not active for user ${this.userId}`);
      return null;
    }

    if (!text || text.trim().length === 0) {
      return null;
    }

    try {
      // Use detected language if available, otherwise use configured source language
      const sourceLanguage = detectedLanguage || this.sourceLanguage;

      // Prepare translation parameters
      const params = {
        Text: text.trim(),
        SourceLanguageCode: sourceLanguage,
        TargetLanguageCode: this.targetLanguage,
      };

      const startTime = Date.now();
      this.translationCount++;

      console.log(`\n📤 [Translation #${this.translationCount}] User: ${this.userId}`);
      console.log(`   Source (${sourceLanguage}): "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

      // Execute translation
      const command = new TranslateTextCommand(params);
      const response = await this.client.send(command);

      const translatedText = response.TranslatedText;
      const duration = Date.now() - startTime;

      if (translatedText && translatedText.trim().length > 0) {
        console.log(`📥 [Translation #${this.translationCount}] Completed in ${duration}ms`);
        console.log(`   Target (${this.targetLanguage}): "${translatedText}"`);
        console.log(`   Source Language: ${response.SourceLanguageCode || sourceLanguage}`);
        console.log(`   Target Language: ${response.TargetLanguageCode}`);

        const result = {
          originalText: text.trim(),
          translatedText: translatedText.trim(),
          sourceLanguage: response.SourceLanguageCode || sourceLanguage,
          targetLanguage: response.TargetLanguageCode,
          detectedLanguage: detectedLanguage,
          timestamp: new Date().toISOString(),
          duration: duration,
        };

        this.lastTranslation = result;

        // Trigger callback with translation result
        if (this.translationCallback) {
          this.translationCallback(result);
        }

        return result;
      } else {
        console.warn(`⚠️  [Translation] Empty result for user ${this.userId}`);
        return null;
      }
    } catch (error) {
      console.error(`\n❌ [Translation Error] User: ${this.userId}`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Text: "${text.substring(0, 50)}..."`);
      
      // Check for specific AWS errors
      if (error.name === "ThrottlingException") {
        console.error(`   ⚠️  Rate limit exceeded. Slowing down...`);
      } else if (error.name === "UnsupportedLanguagePairException") {
        console.error(`   ⚠️  Unsupported language pair: ${this.sourceLanguage} → ${this.targetLanguage}`);
      }
      
      return null;
    }
  }

  /**
   * Change translation language pair
   * @param {string} sourceLanguage - Source language code
   * @param {string} targetLanguage - Target language code
   */
  setLanguages(sourceLanguage, targetLanguage) {
    console.log(`\n🔄 [Translation] Changing languages for user ${this.userId}`);
    console.log(`   From: ${this.sourceLanguage} → ${this.targetLanguage}`);
    console.log(`   To: ${sourceLanguage} → ${targetLanguage}`);
    
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
  }

  /**
   * Get the last translation result
   */
  getLastTranslation() {
    return this.lastTranslation;
  }

  /**
   * Get translation statistics
   */
  getStats() {
    return {
      userId: this.userId,
      roomId: this.roomId,
      isActive: this.isActive,
      translationCount: this.translationCount,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      lastTranslation: this.lastTranslation,
    };
  }

  /**
   * Stop the translation service and cleanup resources
   */
  async stop() {
    try {
      this.isActive = false;
      this.client = null;
      this.translationCallback = null;

      console.log(`\n⏹️  [Translation Service] Stopped for user: ${this.userId}`);
      console.log(`   Total translations: ${this.translationCount}`);
      console.log(`   Room: ${this.roomId}\n`);
    } catch (error) {
      console.error(`❌ [Translation] Error stopping for user ${this.userId}:`, error.message);
    }
  }

  /**
   * Get the current status of the translation service
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      userId: this.userId,
      roomId: this.roomId,
      isActive: this.isActive,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      translationCount: this.translationCount,
    };
  }
}

module.exports = { TranslationService };