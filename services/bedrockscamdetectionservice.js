const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const config = require("../config");

/**
 * Enhanced Bedrock Scam Detection Service
 * Identifies user vs caller and protects the user from potential scams
 */
class BedrockScamDetectionService {
  constructor(roomId, userId, userRole = "user") {
    this.roomId = roomId;
    this.userId = userId;
    this.userRole = userRole; // "user" or "caller"
    this.client = null;
    this.isActive = false;
    this.conversationHistory = [];
    this.maxHistoryLength = 20;
    this.analysisCount = 0;
    this.modelId = config.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
    
    // Track speakers
    this.speakers = new Map(); // socketId -> role (user/caller)
    
    // Statistics
    this.stats = {
      totalAnalyses: 0,
      highRiskDetections: 0,
      mediumRiskDetections: 0,
      lowRiskDetections: 0,
      averageRiskScore: 0,
      lastAnalysis: null,
      callerMessagesAnalyzed: 0,
      userMessagesLogged: 0,
    };
  }

  /**
   * Initialize the Bedrock service
   */
  async start() {
    try {
      console.log(`\n🧠 [Bedrock] Starting Scam Detection Service`);
      console.log(`   User ID: ${this.userId} (Role: ${this.userRole})`);
      console.log(`   Room: ${this.roomId}`);
      console.log(`   Model: ${this.modelId}`);
      console.log(`   Protection Mode: ${this.userRole === 'user' ? 'PROTECTING USER' : 'MONITORING CALLER'}`);

      this.client = new BedrockRuntimeClient({
        region: config.AWS_REGION,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });

      this.isActive = true;
      console.log(`✅ [Bedrock] Initialized successfully\n`);

      return true;
    } catch (error) {
      console.error(`❌ [Bedrock] Error starting:`, error.message);
      return false;
    }
  }

  /**
   * Register a speaker with their role
   * @param {string} socketId - Speaker's socket ID
   * @param {string} role - "user" or "caller"
   */
  registerSpeaker(socketId, role) {
    this.speakers.set(socketId, role);
    console.log(`👤 [Bedrock] Registered speaker: ${socketId} as ${role.toUpperCase()}`);
  }

  /**
   * Get the role of a speaker
   * @param {string} socketId - Speaker's socket ID
   * @returns {string} - "user" or "caller" or "unknown"
   */
  getSpeakerRole(socketId) {
    return this.speakers.get(socketId) || "unknown";
  }

  /**
   * Add message to conversation history with role identification
   * @param {string} originalText - Original transcribed text
   * @param {string} translatedText - Translated text
   * @param {string} speakerId - Speaker's socket ID
   */
  addToConversation(originalText, translatedText, speakerId) {
    const role = this.getSpeakerRole(speakerId);
    
    const message = {
      speakerId,
      role, // "user" or "caller"
      originalText,
      translatedText,
      timestamp: new Date().toISOString(),
    };

    this.conversationHistory.push(message);

    // Track statistics
    if (role === "caller") {
      this.stats.callerMessagesAnalyzed++;
    } else if (role === "user") {
      this.stats.userMessagesLogged++;
    }

    // Keep only recent messages
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }

    console.log(`📝 [Bedrock] Added message from ${role.toUpperCase()} (${this.conversationHistory.length} messages)`);
    console.log(`   Text: "${translatedText.substring(0, 60)}${translatedText.length > 60 ? '...' : ''}"`);
  }

  /**
   * Analyze conversation for scam indicators
   * Only triggers analysis when CALLER speaks
   * @param {string} latestTranslatedText - Most recent translated message
   * @param {string} speakerId - ID of the speaker
   * @returns {Promise<Object>} Analysis result with summary and risk score
   */
  async analyzeConversation(latestTranslatedText, speakerId) {
    if (!this.isActive) {
      console.warn(`⚠️  [Bedrock] Service not active`);
      return null;
    }

    const speakerRole = this.getSpeakerRole(speakerId);

    // CRITICAL: Only analyze when CALLER speaks
    // We don't need to analyze the user's speech
    if (speakerRole !== "caller") {
      console.log(`⏭️  [Bedrock] Skipping analysis - speaker is ${speakerRole.toUpperCase()}, not caller`);
      return null;
    }

    try {
      this.analysisCount++;
      const startTime = Date.now();

      console.log(`\n🔍 [Bedrock Analysis #${this.analysisCount}] Analyzing CALLER speech`);
      console.log(`   Room: ${this.roomId}`);
      console.log(`   Caller message: "${latestTranslatedText.substring(0, 80)}${latestTranslatedText.length > 80 ? '...' : ''}"`);
      console.log(`   Conversation history: ${this.conversationHistory.length} messages`);

      // Build conversation context with role labels
      const conversationContext = this.buildConversationContext();

      // Create the analysis prompt focused on protecting the USER
      const systemPrompt = `You are a fraud detection AI assistant protecting vulnerable individuals from scams. You are analyzing a phone conversation where:
- USER: The person being protected (potentially vulnerable/elderly)
- CALLER: The person calling (potential scammer)

Your task is to analyze the CALLER's speech and behavior to protect the USER. Provide:

1. A brief summary of what the CALLER is trying to do (2-3 sentences)
2. A scam probability score (0-100) where:
   - 0-30: Low risk (normal/legitimate conversation)
   - 31-60: Medium risk (some concerning elements from caller)
   - 61-100: High risk (likely scam attempt by caller)

CRITICAL RED FLAGS to detect in CALLER's speech:
- Requesting money, gift cards, bank details, or cryptocurrency
- Creating urgency ("act now", "limited time", "today only")
- Impersonating authority (government, bank, tech support, family member)
- Asking user to keep conversation secret or not tell family
- Too-good-to-be-true offers or prizes
- Requesting personal information (SSN, PIN, passwords, OTP codes)
- Investment opportunities with guaranteed returns
- Threatening language or dire consequences
- Romantic advances followed by money requests
- Asking user to download remote access software
- Requesting payment via unusual methods (gift cards, wire transfer, cryptocurrency)
- Claiming user's account is compromised or suspended
- Pretending to be from IRS, Medicare, Social Security
- Saying user has won a lottery they didn't enter
- Tech support scams claiming virus/malware on computer

Focus on protecting the USER from the CALLER's tactics.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "Brief summary of what the caller is trying to do",
  "scamProbability": <number between 0-100>,
  "riskLevel": "<LOW|MEDIUM|HIGH>",
  "concerns": ["list", "of", "specific", "red", "flags"],
  "reasoning": "Why this caller poses this level of risk to the user",
  "recommendedAction": "What the user should do (hang up, verify identity, etc.)"
}`;

      const userPrompt = `Analyze this phone conversation to protect the USER from potential scam:

${conversationContext}

Latest CALLER message: "${latestTranslatedText}"

Provide your fraud analysis in the specified JSON format, focusing on protecting the USER.`;

      // Prepare the Converse API request
      const conversationMessages = [
        {
          role: "user",
          content: [{ text: userPrompt }],
        },
      ];

      const command = new ConverseCommand({
        modelId: this.modelId,
        messages: conversationMessages,
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: 1000,
          temperature: 0.3,
          topP: 0.9,
        },
      });

      // Execute the analysis
      const response = await this.client.send(command);
      const duration = Date.now() - startTime;

      // Extract the response text
      const responseText = response.output.message.content[0].text;

      console.log(`📥 [Bedrock] Response received in ${duration}ms`);

      // Parse JSON response
      let analysisResult;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        console.error(`❌ [Bedrock] Failed to parse JSON:`, parseError.message);
        
        // Return safe default
        analysisResult = {
          summary: "Unable to analyze conversation properly",
          scamProbability: 0,
          riskLevel: "LOW",
          concerns: [],
          reasoning: "Analysis parsing error",
          recommendedAction: "Continue monitoring",
        };
      }

      // Validate and ensure all required fields
      const validatedResult = {
        summary: analysisResult.summary || "No summary available",
        scamProbability: Math.min(100, Math.max(0, analysisResult.scamProbability || 0)),
        riskLevel: analysisResult.riskLevel || "LOW",
        concerns: Array.isArray(analysisResult.concerns) ? analysisResult.concerns : [],
        reasoning: analysisResult.reasoning || "No reasoning provided",
        recommendedAction: analysisResult.recommendedAction || "Continue monitoring",
        timestamp: new Date().toISOString(),
        duration: duration,
        analysisCount: this.analysisCount,
        callerMessage: latestTranslatedText,
        roomId: this.roomId,
      };

      // Update statistics
      this.updateStats(validatedResult);

      // Log the analysis result
      this.logAnalysisResult(validatedResult);

      this.stats.lastAnalysis = validatedResult;

      return validatedResult;

    } catch (error) {
      console.error(`\n❌ [Bedrock] Analysis error:`, error.message);
      
      if (error.name === "ThrottlingException") {
        console.error(`   ⚠️  Rate limit exceeded`);
      } else if (error.name === "ValidationException") {
        console.error(`   ⚠️  Invalid request parameters`);
      }

      return null;
    }
  }

  /**
   * Build conversation context with role labels
   */
  buildConversationContext() {
    if (this.conversationHistory.length === 0) {
      return "No previous conversation history.";
    }

    const context = this.conversationHistory
      .map((msg, index) => {
        const roleLabel = msg.role === "user" ? "USER" : msg.role === "caller" ? "CALLER" : "UNKNOWN";
        return `[Message ${index + 1}] ${roleLabel}: "${msg.translatedText}"`;
      })
      .join('\n');

    return context;
  }

  /**
   * Log analysis result with appropriate severity
   */
  logAnalysisResult(result) {
    console.log(`\n✅ [Bedrock Analysis #${this.analysisCount}] Completed in ${result.duration}ms`);
    
    if (result.riskLevel === "HIGH") {
      console.log(`${'🚨'.repeat(40)}`);
      console.log(`🚨 [HIGH RISK SCAM DETECTED] 🚨`);
      console.log(`${'🚨'.repeat(40)}`);
      console.log(`   Room: ${this.roomId}`);
      console.log(`   Risk Score: ${result.scamProbability}%`);
      console.log(`   Caller said: "${result.callerMessage}"`);
      console.log(`   Summary: ${result.summary}`);
      console.log(`   Concerns: ${result.concerns.join(', ')}`);
      console.log(`   Reasoning: ${result.reasoning}`);
      console.log(`   ⚠️  RECOMMENDED ACTION: ${result.recommendedAction}`);
      console.log(`${'🚨'.repeat(40)}\n`);
    } else if (result.riskLevel === "MEDIUM") {
      console.log(`${'─'.repeat(80)}`);
      console.log(`⚠️  [MEDIUM RISK DETECTED]`);
      console.log(`   Risk Score: ${result.scamProbability}%`);
      console.log(`   Summary: ${result.summary}`);
      console.log(`   Concerns: ${result.concerns.join(', ')}`);
      console.log(`   Recommended Action: ${result.recommendedAction}`);
      console.log(`${'─'.repeat(80)}\n`);
    } else {
      console.log(`${'─'.repeat(80)}`);
      console.log(`✅ [LOW RISK] Conversation appears normal`);
      console.log(`   Risk Score: ${result.scamProbability}%`);
      console.log(`   Summary: ${result.summary}`);
      console.log(`${'─'.repeat(80)}\n`);
    }
  }

  /**
   * Update statistics
   */
  updateStats(result) {
    this.stats.totalAnalyses++;

    if (result.riskLevel === "HIGH") {
      this.stats.highRiskDetections++;
    } else if (result.riskLevel === "MEDIUM") {
      this.stats.mediumRiskDetections++;
    } else {
      this.stats.lowRiskDetections++;
    }

    // Calculate rolling average
    const prevTotal = this.stats.averageRiskScore * (this.stats.totalAnalyses - 1);
    this.stats.averageRiskScore = (prevTotal + result.scamProbability) / this.stats.totalAnalyses;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      userId: this.userId,
      userRole: this.userRole,
      roomId: this.roomId,
      isActive: this.isActive,
      conversationHistoryLength: this.conversationHistory.length,
      analysisCount: this.analysisCount,
      speakers: Array.from(this.speakers.entries()).map(([id, role]) => ({ id, role })),
      stats: {
        ...this.stats,
        averageRiskScore: Math.round(this.stats.averageRiskScore * 100) / 100,
      },
    };
  }

  /**
   * Get conversation history with role labels
   */
  getConversationHistory() {
    return this.conversationHistory.map(msg => ({
      role: msg.role,
      text: msg.translatedText,
      timestamp: msg.timestamp,
    }));
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    console.log(`\n🗑️  [Bedrock] Clearing conversation history`);
    this.conversationHistory = [];
  }

  /**
   * Stop the service and cleanup
   */
  async stop() {
    try {
      this.isActive = false;
      this.client = null;

      console.log(`\n⏹️  [Bedrock] Stopped`);
      console.log(`   Total analyses: ${this.analysisCount}`);
      console.log(`   Caller messages analyzed: ${this.stats.callerMessagesAnalyzed}`);
      console.log(`   User messages logged: ${this.stats.userMessagesLogged}`);
      console.log(`   High risk detections: ${this.stats.highRiskDetections}`);
      console.log(`   Medium risk detections: ${this.stats.mediumRiskDetections}`);
      console.log(`   Low risk detections: ${this.stats.lowRiskDetections}`);
      console.log(`   Average risk score: ${this.stats.averageRiskScore.toFixed(2)}%`);
    } catch (error) {
      console.error(`❌ [Bedrock] Error stopping:`, error.message);
    }
  }
}

module.exports = { BedrockScamDetectionService };