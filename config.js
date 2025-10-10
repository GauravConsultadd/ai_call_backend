require("dotenv").config();

const config = {
  // Server Configuration
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || "development",

  // CORS Configuration
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000", "http://localhost:3001"],

  // AWS Configuration
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_TRANSCRIBE_ACCESS_KEY_ID: process.env.AWS_TRANSCRIBE_ACCESS_KEY_ID,
  AWS_TRANSCRIBE_SECRET_ACCESS_KEY: process.env.AWS_TRANSCRIBE_SECRET_ACCESS_KEY,

  // Transcription Configuration
  // Set to 'identify-language' for automatic language detection
  TRANSCRIBE_LANGUAGE_CODE: "identify-language",
  
  // Preferred languages for auto-detection (optional but recommended)
  // AWS will identify from these languages for better accuracy
  LANGUAGE_OPTIONS: process.env.LANGUAGE_OPTIONS
    ? process.env.LANGUAGE_OPTIONS.split(",")
    : [
        "en-US", // English (US)
        "en-GB", // English (UK)
        "es-ES", // Spanish (Spain)
        "es-US", // Spanish (US)
        "fr-FR", // French
        "de-DE", // German
        "it-IT", // Italian
        "pt-BR", // Portuguese (Brazil)
        "ja-JP", // Japanese
        "zh-CN", // Chinese (Simplified)
        "ko-KR", // Korean
        "ar-SA", // Arabic
        "hi-IN", // Hindi
        "ru-RU", // Russian
      ],

  // Preferred language for when auto-detection is not used
  PREFERRED_LANGUAGE: process.env.PREFERRED_LANGUAGE || "en-US",

  // Audio Configuration
  SAMPLE_RATE: parseInt(process.env.SAMPLE_RATE) || 16000,

  // Enable/Disable automatic language identification
  ENABLE_LANGUAGE_IDENTIFICATION: 
    process.env.ENABLE_LANGUAGE_IDENTIFICATION !== "false", // true by default

  // Vocabulary filter (optional) - for profanity filtering
  VOCABULARY_FILTER_NAME: process.env.VOCABULARY_FILTER_NAME || null,
  VOCABULARY_FILTER_METHOD: process.env.VOCABULARY_FILTER_METHOD || "mask", // mask, remove, or tag

  // Content redaction (optional) - for PII redaction
  ENABLE_CONTENT_REDACTION: process.env.ENABLE_CONTENT_REDACTION === "true",
  CONTENT_REDACTION_TYPE: process.env.CONTENT_REDACTION_TYPE || "PII", // PII only option

  // Partial results stabilization
  ENABLE_PARTIAL_RESULTS_STABILIZATION: 
    process.env.ENABLE_PARTIAL_RESULTS_STABILIZATION !== "false", // true by default
  PARTIAL_RESULTS_STABILITY: process.env.PARTIAL_RESULTS_STABILITY || "high", // low, medium, high

  // Validation
  validate() {
    const required = [
      "AWS_TRANSCRIBE_ACCESS_KEY_ID",
      "AWS_TRANSCRIBE_SECRET_ACCESS_KEY",
      "AWS_REGION",
    ];

    const missing = required.filter((key) => !this[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}\n` +
        `Please check your .env file`
      );
    }

    // Validate language configuration
    if (this.ENABLE_LANGUAGE_IDENTIFICATION) {
      if (this.TRANSCRIBE_LANGUAGE_CODE !== "identify-language" && 
          !this.LANGUAGE_OPTIONS.includes(this.TRANSCRIBE_LANGUAGE_CODE)) {
        console.warn(
          `⚠️ Warning: TRANSCRIBE_LANGUAGE_CODE "${this.TRANSCRIBE_LANGUAGE_CODE}" ` +
          `is not in LANGUAGE_OPTIONS. Auto-detection may not work as expected.`
        );
      }
    }

    // Validate sample rate
    const validSampleRates = [8000, 16000, 32000, 44100, 48000];
    if (!validSampleRates.includes(this.SAMPLE_RATE)) {
      console.warn(
        `⚠️ Warning: SAMPLE_RATE ${this.SAMPLE_RATE} may not be optimal. ` +
        `Recommended: 16000 Hz for speech recognition.`
      );
    }

    console.log("✅ Configuration validated successfully");
    console.log(`📊 Language Detection: ${this.ENABLE_LANGUAGE_IDENTIFICATION ? "Enabled" : "Disabled"}`);
    
    if (this.ENABLE_LANGUAGE_IDENTIFICATION) {
      console.log(`🌍 Supported Languages: ${this.LANGUAGE_OPTIONS.length} languages`);
      console.log(`🎯 Language Options: ${this.LANGUAGE_OPTIONS.slice(0, 5).join(", ")}...`);
    } else {
      console.log(`🗣️ Fixed Language: ${this.TRANSCRIBE_LANGUAGE_CODE}`);
    }
  },

  // Get transcription parameters based on configuration
  getTranscriptionParams() {
    const params = {
      MediaEncoding: "pcm",
      MediaSampleRateHertz: this.SAMPLE_RATE,
    };

    // Configure language identification
    if (this.ENABLE_LANGUAGE_IDENTIFICATION) {
      params.IdentifyLanguage = true;
      
      // Add language options if specified
      if (this.LANGUAGE_OPTIONS && this.LANGUAGE_OPTIONS.length > 0) {
        params.LanguageOptions = this.LANGUAGE_OPTIONS.join(",");
      }

      // Set preferred language if specified
      if (this.PREFERRED_LANGUAGE) {
        params.PreferredLanguage = this.PREFERRED_LANGUAGE;
      }
    } else {
      // Use fixed language code
      params.LanguageCode = this.TRANSCRIBE_LANGUAGE_CODE;
    }

    // Add partial results stabilization
    if (this.ENABLE_PARTIAL_RESULTS_STABILIZATION) {
      params.EnablePartialResultsStabilization = true;
      params.PartialResultsStability = this.PARTIAL_RESULTS_STABILITY;
    }

    // Add vocabulary filter if configured
    if (this.VOCABULARY_FILTER_NAME) {
      params.VocabularyFilterName = this.VOCABULARY_FILTER_NAME;
      params.VocabularyFilterMethod = this.VOCABULARY_FILTER_METHOD;
    }

    // Add content redaction if enabled
    if (this.ENABLE_CONTENT_REDACTION) {
      params.ContentRedactionType = this.CONTENT_REDACTION_TYPE;
    }

    return params;
  },
};

// Validate configuration on load
try {
  config.validate();
} catch (error) {
  console.error("❌ Configuration error:", error.message);
  process.exit(1);
}

module.exports = config;