/**
 * OpenRouter Client
 * Handles LLM requests for sentiment analysis
 */
const axios = require('axios');
const logger = require('../utils/logger');

class OpenRouterClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
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
      const response = await axios.post(
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
      const result = this.parseResponse(response.data, messages.length);

      // Add metadata
      result.processingTime = processingTime;
      result.tokensUsed = response.data.usage?.total_tokens || 0;
      result.model = this.model;

      logger.info(`LLM batch processed: ${messages.length} messages in ${processingTime}ms`);

      return result;

    } catch (error) {
      logger.error(`OpenRouter API error: ${error.message}`);

      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }

      throw error;
    }
  }

  /**
   * Build prompt for LLM
   */
  buildPrompt(messages, enabledTags, excludedFromSentiment) {
    const messageBatch = messages.map((msg, idx) => {
      return `${idx + 1}. [${msg.author.username}]: ${msg.text}`;
    }).join('\n');

    return `Analyze the following ${messages.length} messages for sentiment and tags.

ENABLED TAGS: ${enabledTags.join(', ')}

SENTIMENT SCALE: -100 (very negative) to +100 (very positive), 0 is neutral

TAGS TO EXCLUDE FROM SENTIMENT: ${excludedFromSentiment.join(', ')}

MESSAGES:
${messageBatch}

Return a JSON object with this EXACT structure:
{
  "batch_sentiment": <average sentiment of all messages>,
  "message_count": ${messages.length},
  "author_count": <unique authors>,
  "tag_counts": {<tag>: <count>, ...},
  "per_user": [
    {
      "user_id": "<platform:id>",
      "username": "<username>",
      "message_count": <count>,
      "sentiment_avg": <average sentiment>,
      "tags": {<tag>: <count>, ...}
    }
  ]
}

IMPORTANT:
- Only use tags from the ENABLED TAGS list
- Do NOT include zero-count tags
- Calculate batch_sentiment as average, excluding messages with tags in "TAGS TO EXCLUDE FROM SENTIMENT"
- For each user, provide their message count, average sentiment, and tag distribution`;
  }

  /**
   * Parse LLM response
   */
  parseResponse(response, messageCount) {
    try {
      const content = response.choices[0].message.content;

      // Try to extract JSON from response
      let jsonStr = content;

      // If wrapped in markdown code block, extract it
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.batch_sentiment || !parsed.tag_counts || !parsed.per_user) {
        throw new Error('Invalid LLM response structure');
      }

      return {
        sentimentScore: parsed.batch_sentiment,
        messageCount: parsed.message_count || messageCount,
        authorCount: parsed.author_count || parsed.per_user.length,
        tagCounts: parsed.tag_counts,
        perUser: parsed.per_user
      };

    } catch (error) {
      logger.error(`Failed to parse LLM response: ${error.message}`);
      logger.error(`Response content: ${response.choices[0].message.content}`);
      throw new Error('Failed to parse LLM response');
    }
  }
}

module.exports = OpenRouterClient;
