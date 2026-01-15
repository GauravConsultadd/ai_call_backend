require("dotenv").config();

module.exports = {
  // Server Configuration
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || "development",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"],

  // AWS Configuration
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,

  // AWS Transcribe Configuration
  TRANSCRIBE_LANGUAGE_CODE: process.env.TRANSCRIBE_LANGUAGE_CODE || "hi-IN", // Hindi (India)
  SAMPLE_RATE: parseInt(process.env.SAMPLE_RATE || "16000", 10),
  ENABLE_LANGUAGE_IDENTIFICATION: process.env.ENABLE_LANGUAGE_IDENTIFICATION === "true",

  // AWS Bedrock Configuration
  BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || "",
  BEDROCK_MAX_TOKENS: parseInt(process.env.BEDROCK_MAX_TOKENS || "1000", 10),
  BEDROCK_TEMPERATURE: parseFloat(process.env.BEDROCK_TEMPERATURE || "0.3"),
  
  // Scam Detection Configuration
  SCAM_DETECTION_ENABLED: process.env.SCAM_DETECTION_ENABLED !== "false", // Enabled by default
  HIGH_RISK_THRESHOLD: parseInt(process.env.HIGH_RISK_THRESHOLD || "61", 10),
  MEDIUM_RISK_THRESHOLD: parseInt(process.env.MEDIUM_RISK_THRESHOLD || "31", 10),
  CONVERSATION_HISTORY_LENGTH: parseInt(process.env.CONVERSATION_HISTORY_LENGTH || "20", 10),
};