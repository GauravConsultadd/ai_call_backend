const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const config = require("../config");

/**
 * Simplified Bedrock Scam Detection Service
 * Analyzes ALL participants equally for fraud/scam behavior
 */
class BedrockScamDetectionService {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.client = null;
    this.isActive = false;
    this.conversationHistory = [];
    this.maxHistoryLength = 20;
    this.analysisCount = 0;
    this.modelId = config.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
    
    // Statistics
    this.stats = {
      totalAnalyses: 0,
      highRiskDetections: 0,
      mediumRiskDetections: 0,
      lowRiskDetections: 0,
      averageRiskScore: 0,
      lastAnalysis: null,
    };
  }

  /**
   * Initialize the Bedrock service
   */
  async start() {
    try {
      console.log(`\n🧠 [Bedrock] Starting Scam Detection Service`);
      console.log(`   User ID: ${this.userId}`);
      console.log(`   Room: ${this.roomId}`);
      console.log(`   Model: ${this.modelId}`);

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
   * Add message to conversation history
   * @param {string} translatedText - Translated text
   * @param {string} speakerId - Speaker's socket ID
   */
  addToConversation(translatedText, speakerId) {
    const message = {
      speakerId,
      text: translatedText,
      timestamp: new Date().toISOString(),
    };

    this.conversationHistory.push(message);

    // Keep only recent messages
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }

    console.log(`📝 [Bedrock] Added message (${this.conversationHistory.length} total messages)`);
  }

  /**
   * Analyze conversation for fraud/scam indicators
   * Analyzes EVERYONE's speech equally
   * @param {string} latestTranslatedText - Most recent translated message
   * @param {string} speakerId - ID of the speaker
   * @returns {Promise<Object>} Analysis result with fraud score
   */
  async analyzeConversation(latestTranslatedText, speakerId) {
    if (!this.isActive) {
      console.warn(`⚠️  [Bedrock] Service not active`);
      return null;
    }

    try {
      this.analysisCount++;
      const startTime = Date.now();

      console.log(`\n🔍 [Bedrock Analysis #${this.analysisCount}] Analyzing message...`);
      console.log(`   Speaker: ${speakerId}`);
      console.log(`   Message: "${latestTranslatedText.substring(0, 80)}${latestTranslatedText.length > 80 ? '...' : ''}"`);

      // Build conversation context
      const conversationContext = this.buildConversationContext();

      // Create the analysis prompt with common fraud patterns
      const systemPrompt = `You are a fraud detection AI assistant that analyzes conversations for potential scam or fraudulent behavior. You analyze ALL participants equally - anyone in the conversation could be attempting fraud.

Your task is to analyze the LATEST message and provide:

1. A brief summary of what the speaker is trying to do (2-3 sentences)
2. A fraud probability score (0-100) where:
   - 0-30: Low risk (normal conversation)
   - 31-80: Medium risk (some concerning elements)
   - 81-100: High risk (likely fraud/scam attempt)

CRITICAL FRAUD INDICATORS to detect:
- Money requests (gift cards, wire transfers, cryptocurrency, cash)
- Urgency or pressure tactics ("act now", "limited time", "today only")
- Authority impersonation (government, bank, tech support, police, family member)
- Secrecy requests ("don't tell anyone", "keep this between us")
- Too-good-to-be-true offers (prizes, inheritances, guaranteed returns)
- Personal information requests (SSN, PIN, passwords, OTP codes, bank details)
- Investment opportunities with guaranteed returns or low risk
- Threatening language or consequences ("arrest", "lawsuit", "account frozen")
- Romantic advances followed by financial requests
- Remote access requests (TeamViewer, AnyDesk, "let me help fix your computer")
- Unusual payment methods (gift cards for taxes/fees, prepaid cards)
- Fake emergencies ("grandchild in jail", "stranded abroad")
- IRS/tax scams, Medicare scams, Social Security scams
- Tech support scams claiming viruses or expired warranties
- Lottery/sweepstakes scams for contests not entered
- Phishing attempts for login credentials
- Charity scams (especially after disasters)

COMMON FRAUD PATTERNS IN KNOWLEDGE BASE:
1. IRS Scam: "You owe back taxes, pay now or face arrest"
2. Tech Support: "Your computer has viruses, we need remote access"
3. Grandparent Scam: "It's your grandson, I'm in trouble and need money"
4. Romance Scam: Build relationship online, then ask for money
5. Prize Scam: "You won a lottery you never entered, pay fees first"
6. Bank Impersonation: "Your account is compromised, verify your details"
7. Gift Card Scam: Any request to pay with gift cards (major red flag)
8. Investment Fraud: "Guaranteed returns" or "no risk" investments
9. Charity Fraud: Fake charities asking for donations
10. Employment Scam: "Pay upfront fee for job training/equipment"

Analyze the conversation objectively - BOTH participants can exhibit fraudulent behavior.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "Brief summary of what the speaker is attempting",
  "fraudScore": <number between 0-100>,
  "riskLevel": "<LOW|MEDIUM|HIGH>",
  "redFlags": ["list", "of", "specific", "fraud", "indicators"],
  "reasoning": "Why this message received this fraud score",
  "matchedPatterns": ["list", "of", "matched", "common", "fraud", "patterns"]
}`;

      const userPrompt = `Analyze this conversation for potential fraud or scam behavior:

${conversationContext}

Latest message from Speaker ${speakerId}: "${latestTranslatedText}"

Provide your fraud analysis in the specified JSON format.`;

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
          summary: "Unable to analyze conversation",
          fraudScore: 0,
          riskLevel: "LOW",
          redFlags: [],
          reasoning: "Analysis parsing error",
          matchedPatterns: [],
        };
      }

      // Validate and ensure all required fields
      const validatedResult = {
        summary: analysisResult.summary || "No summary available",
        fraudScore: Math.min(100, Math.max(0, analysisResult.fraudScore || 0)),
        riskLevel: analysisResult.riskLevel || "LOW",
        redFlags: Array.isArray(analysisResult.redFlags) ? analysisResult.redFlags : [],
        reasoning: analysisResult.reasoning || "No reasoning provided",
        matchedPatterns: Array.isArray(analysisResult.matchedPatterns) ? analysisResult.matchedPatterns : [],
        timestamp: new Date().toISOString(),
        duration: duration,
        analysisCount: this.analysisCount,
        speakerId: speakerId,
        message: latestTranslatedText,
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
   * Build conversation context
   */
  buildConversationContext() {
    if (this.conversationHistory.length === 0) {
      return "No previous conversation history.";
    }

    const context = this.conversationHistory
      .map((msg, index) => {
        return `[Message ${index + 1}] Speaker ${msg.speakerId}: "${msg.text}"`;
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
      console.log(`🚨 [HIGH FRAUD RISK DETECTED] 🚨`);
      console.log(`${'🚨'.repeat(40)}`);
      console.log(`   Speaker: ${result.speakerId}`);
      console.log(`   Fraud Score: ${result.fraudScore}%`);
      console.log(`   Message: "${result.message.substring(0, 80)}..."`);
      console.log(`   Summary: ${result.summary}`);
      console.log(`   Red Flags: ${result.redFlags.join(', ')}`);
      console.log(`   Matched Patterns: ${result.matchedPatterns.join(', ')}`);
      console.log(`   Reasoning: ${result.reasoning}`);
      console.log(`${'🚨'.repeat(40)}\n`);
    } else if (result.riskLevel === "MEDIUM") {
      console.log(`${'─'.repeat(80)}`);
      console.log(`⚠️  [MEDIUM FRAUD RISK]`);
      console.log(`   Speaker: ${result.speakerId}`);
      console.log(`   Fraud Score: ${result.fraudScore}%`);
      console.log(`   Summary: ${result.summary}`);
      console.log(`   Red Flags: ${result.redFlags.join(', ')}`);
      console.log(`${'─'.repeat(80)}\n`);
    } else {
      console.log(`${'─'.repeat(80)}`);
      console.log(`✅ [LOW FRAUD RISK] Conversation appears normal`);
      console.log(`   Speaker: ${result.speakerId}`);
      console.log(`   Fraud Score: ${result.fraudScore}%`);
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
    this.stats.averageRiskScore = (prevTotal + result.fraudScore) / this.stats.totalAnalyses;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      userId: this.userId,
      roomId: this.roomId,
      isActive: this.isActive,
      conversationHistoryLength: this.conversationHistory.length,
      analysisCount: this.analysisCount,
      stats: {
        ...this.stats,
        averageRiskScore: Math.round(this.stats.averageRiskScore * 100) / 100,
      },
    };
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
      console.log(`   High risk: ${this.stats.highRiskDetections}`);
      console.log(`   Medium risk: ${this.stats.mediumRiskDetections}`);
      console.log(`   Low risk: ${this.stats.lowRiskDetections}`);
      console.log(`   Average fraud score: ${this.stats.averageRiskScore.toFixed(2)}%`);
    } catch (error) {
      console.error(`❌ [Bedrock] Error stopping:`, error.message);
    }
  }
}

module.exports = { BedrockScamDetectionService };