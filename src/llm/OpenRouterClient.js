/**
 * OpenRouter Client
 * Handles LLM requests for sentiment analysis
 */
const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');

class OpenRouterClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;

    // Create axios instance with IPv4 configuration
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        family: 4, // Force IPv4
        keepAlive: true
      }),
      timeout: 60000
    });
  }

  /**
   * Analyze a batch of messages
   */
  async analyzeBatch(messages, enabledTags, excludedFromSentiment) {
    try {
      const startTime = Date.now();

      // Build prompt
      const prompt = this.buildPrompt(messages, enabledTags, excludedFromSentiment);

      // Call OpenRouter
      const response = await this.axiosInstance.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a sentiment analysis expert. Analyze messages and return structured JSON output with sentiment scores and tags.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://salt-index.app',
            'X-Title': 'Salt Index'
          }
        }
      );

      const processingTime = Date.now() - startTime;

      // Parse response
      const result = this.parseResponse(response.data, messages, enabledTags);

      // Add metadata
      result.processingTime = processingTime;
      result.tokensUsed = response.data.usage?.total_tokens || 0;
      result.model = this.model;

      logger.info(`LLM batch processed: ${messages.length} messages in ${processingTime}ms`);

      return result;

    } catch (error) {
      // Handle axios errors with better messaging
      let errorMsg = error.message || 'Unknown error';

      if (error.response) {
        // HTTP error response from OpenRouter
        const status = error.response.status;
        const data = error.response.data;
        errorMsg = `HTTP ${status}: ${data.error?.message || JSON.stringify(data)}`;

        logger.error(`OpenRouter API error: ${errorMsg}`);
        logger.error(`Response status: ${status}`);
        logger.error(`Response data: ${JSON.stringify(data)}`);
      } else if (error.request) {
        // Request made but no response
        errorMsg = 'No response from OpenRouter API - network error';
        logger.error(`OpenRouter API error: ${errorMsg}`);
        logger.error('No response received from OpenRouter');
      } else {
        // Something else went wrong
        logger.error(`OpenRouter API error: ${errorMsg}`);
      }

      // Throw a new error with better message
      throw new Error(errorMsg);
    }
  }

  /**
   * Build prompt for LLM
   */
  buildPrompt(messages, enabledTags, excludedFromSentiment) {
    // Separate target and context messages
    const targetMessages = messages.filter(m => !m.isContext);
    const contextMessages = messages.filter(m => m.isContext);

    let prompt = `Analyze the following messages for sentiment and tags.

ENABLED TAGS (YOU MUST ONLY USE THESE EXACT TAGS - DO NOT USE ANY OTHER TAGS):
${enabledTags.join(', ')}

SENTIMENT SCALE: -100 (very negative) to +100 (very positive), 0 is neutral

TAGS TO EXCLUDE FROM SENTIMENT: ${excludedFromSentiment.join(', ')}

`;

    // Add context messages if present
    if (contextMessages.length > 0) {
      const contextBatch = contextMessages.map((msg, idx) => {
        const userId = `${msg.platform}:${msg.author.id}`;
        return `${idx + 1}. [${userId} (${msg.author.username})]: ${msg.text}`;
      }).join('\n');

      prompt += `CONTEXT MESSAGES (for understanding only, DO NOT analyze these):
${contextBatch}

`;
    }

    // Add target messages
    const targetBatch = targetMessages.map((msg, idx) => {
      const userId = `${msg.platform}:${msg.author.id}`;
      return `${idx + 1}. [${userId} (${msg.author.username})]: ${msg.text}`;
    }).join('\n');

    prompt += `TARGET MESSAGES (analyze these only):
${targetBatch}

Return a JSON object with this EXACT structure:
{
  "batch_sentiment": <average sentiment of TARGET messages only>,
  "message_count": ${targetMessages.length},
  "author_count": <unique authors in TARGET messages>,
  "tag_counts": {<tag>: <count>, ...},
  "per_user": [
    {
      "user_id": "<use the exact platform:id from message header>",
      "username": "<username from message header>",
      "message_count": <count>,
      "sentiment_avg": <average sentiment>,
      "tags": {<tag>: <count>, ...}
    }
  ]
}

CRITICAL RULES:
- Only analyze and count TARGET messages (ignore CONTEXT messages)
- ONLY use tags from the ENABLED TAGS list above - DO NOT make up new tags or use synonyms
- If you want to use a tag that is not in the ENABLED TAGS list, DO NOT include it
- Do NOT include zero-count tags in the output
- Calculate batch_sentiment as average of TARGET messages, excluding messages with tags in "TAGS TO EXCLUDE FROM SENTIMENT"
- For each user in per_user array, use the EXACT user_id from the message header (format: "platform:id")
- For each user, provide their message count, average sentiment, and tag distribution (from TARGET messages only)`;

    return prompt;
  }

  /**
   * Parse LLM response
   */
  parseResponse(response, messages, enabledTags) {
    try {
      const messageCount = messages.length;
      const content = response.choices[0].message.content;

      // Try to extract JSON from response
      let jsonStr = content;

      // If wrapped in markdown code block, extract it
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // Extract JSON object even if there's extra text after it
        // Find the first { and match braces to get complete JSON object
        const firstBrace = content.indexOf('{');
        if (firstBrace !== -1) {
          let braceCount = 0;
          let endIndex = firstBrace;

          for (let i = firstBrace; i < content.length; i++) {
            if (content[i] === '{') braceCount++;
            if (content[i] === '}') braceCount--;

            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }

          jsonStr = content.substring(firstBrace, endIndex);
        }
      }

      const parsed = JSON.parse(jsonStr);

      // Log LLM's per_user user_ids for debugging
      logger.info(`[LLM RESPONSE DEBUG] LLM returned ${parsed.per_user.length} per_user entries:`);
      parsed.per_user.forEach((user, i) => {
        logger.info(`  [${i+1}] user_id: "${user.user_id}", username: "${user.username}"`);
      });

      // Validate structure (check for null/undefined, not falsy values since 0 is valid)
      if (parsed.batch_sentiment === null || parsed.batch_sentiment === undefined ||
          !parsed.tag_counts || !parsed.per_user) {
        throw new Error('Invalid LLM response structure');
      }

      // Clamp sentiment to valid range (-100 to +100) and round to nearest whole number
      let sentiment = parsed.batch_sentiment;
      if (sentiment < -100) {
        logger.warn(`LLM returned sentiment ${sentiment}, clamping to -100`);
        sentiment = -100;
      } else if (sentiment > 100) {
        logger.warn(`LLM returned sentiment ${sentiment}, clamping to +100`);
        sentiment = 100;
      }
      // Round to nearest whole number
      sentiment = Math.round(sentiment);

      // Filter out unauthorized tags from tag_counts
      const filteredTagCounts = {};
      const unauthorizedTags = [];

      for (const [tag, count] of Object.entries(parsed.tag_counts)) {
        if (enabledTags.includes(tag)) {
          filteredTagCounts[tag] = count;
        } else {
          unauthorizedTags.push(tag);
        }
      }

      if (unauthorizedTags.length > 0) {
        logger.warn(`LLM returned unauthorized tags (filtered out): ${unauthorizedTags.join(', ')}`);
      }

      // Create a mapping from username to full platform:id format
      const usernameToId = {};
      messages.filter(m => !m.isContext).forEach(msg => {
        const fullId = `${msg.platform}:${msg.author.id}`;
        usernameToId[msg.author.username] = fullId;
      });

      // Filter unauthorized tags from per_user data, fix user_ids, and round sentiment averages
      const filteredPerUser = parsed.per_user.map(user => {
        const filteredUserTags = {};
        for (const [tag, count] of Object.entries(user.tags || {})) {
          if (enabledTags.includes(tag)) {
            filteredUserTags[tag] = count;
          }
        }

        // Validate user_id format and fix if needed (fallback for LLM not following instructions)
        let correctedUserId = user.user_id;
        if (!correctedUserId.includes(':')) {
          // LLM didn't follow instructions, map username to full platform:id
          correctedUserId = usernameToId[correctedUserId] || correctedUserId;
          logger.warn(`[USER ID FIX] LLM returned username instead of platform:id. Mapped "${user.user_id}" -> "${correctedUserId}"`);
        }

        return {
          ...user,
          user_id: correctedUserId,
          sentiment_avg: Math.round(user.sentiment_avg || 0),  // Round to nearest whole number
          tags: filteredUserTags
        };
      });

      return {
        sentimentScore: sentiment,
        messageCount: parsed.message_count || messageCount,
        authorCount: parsed.author_count || parsed.per_user.length,
        tagCounts: filteredTagCounts,
        perUser: filteredPerUser
      };

    } catch (error) {
      logger.error(`Failed to parse LLM response: ${error.message}`);
      logger.error(`Response content: ${response.choices[0].message.content}`);
      throw new Error('Failed to parse LLM response');
    }
  }
}

module.exports = OpenRouterClient;
