// config/aws.js
require("dotenv").config();
const AWS = require("aws-sdk");

// 🔧 Configure AWS SDK with environment variables
AWS.config.update({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  logger: console, // ✅ Enable AWS SDK logging
});

// 🧩 Validate AWS credentials
const validateCredentials = () => {
  console.log("\n🔍 Validating AWS Configuration...");
  console.log("AWS_REGION:", process.env.AWS_REGION || "❌ NOT SET");
  console.log(
    "AWS_ACCESS_KEY_ID:",
    process.env.AWS_ACCESS_KEY_ID
      ? `✅ ${process.env.AWS_ACCESS_KEY_ID.substring(0, 8)}...`
      : "❌ NOT SET"
  );
  console.log(
    "AWS_SECRET_ACCESS_KEY:",
    process.env.AWS_SECRET_ACCESS_KEY ? "✅ SET (hidden)" : "❌ NOT SET"
  );

  const required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      "❌ Missing required AWS environment variables:",
      missing.join(", ")
    );
    console.error("Please add them to your .env file");
    return false;
  }

  console.log("✅ AWS credentials validated\n");
  return true;
};

const isValid = validateCredentials();

if (!isValid) {
  console.error(
    "\n❌ WARNING: AWS Transcribe will not work without valid credentials!\n"
  );
}

// 📦 Export unified configuration
module.exports = {
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  transcribe: {
    languageCode: "en-US",
    mediaSampleRateHertz: 16000,
    mediaEncoding: "pcm",
  },
  isValid,
};
