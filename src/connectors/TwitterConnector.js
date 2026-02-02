/**
 * Twitter Connector
 * Monitors Twitter/X for tweets based on search queries or user timelines
 */
const { TwitterApi } = require('twitter-api-v2');
const BaseConnector = require('./BaseConnector');
const logger = require('../utils/logger');

class TwitterConnector extends BaseConnector {
  constructor(source, config) {
    super(source, config);
    this.client = null;
    this.stream = null;
    this.polling = false;
    this.seenMessages = new Set();
    this.pollInterval = null;
  }

  /**
   * Connect to Twitter
   */
  async connect() {
    try {
      logger.info(`Connecting Twitter source: ${this.source.id} (${this.source.target})`);

      // Validate config
      if (!this.config.twitter || !this.config.twitter.bearerToken) {
        throw new Error('Twitter bearer token not configured in environment');
      }

      const bearerToken = this.config.twitter.bearerToken.trim();

      // Validate bearer token format
      if (bearerToken.length === 0) {
        throw new Error('Twitter bearer token is empty');
      }

      // Create Twitter client (read-only with bearer token)
      this.client = new TwitterApi(bearerToken);

      // Note: Cannot verify credentials with bearer token (app-only auth has no user context)
      // Connection will be validated when first API call is made

      logger.info(`Twitter client initialized for ${this.source.id}`);

      // Validate and start monitoring based on mode
      const mode = this.source.config?.mode || 'search';

      // Validate mode
      if (mode !== 'stream' && mode !== 'search') {
        logger.warn(`Invalid mode '${mode}' for ${this.source.id}, defaulting to 'search'`);
      }

      // Clear any existing polling interval before starting new one
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      if (mode === 'stream') {
        await this.startStreamMonitoring();
      } else {
        await this.startPollingMonitoring();
      }

      // Only set healthy AFTER monitoring successfully starts
      this.updateHealth('healthy');
      logger.info(`Twitter source connected: ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to connect Twitter source ${this.source.id}: ${error.message}`);
      this.updateHealth('failed', error.message);
      throw error;
    }
  }

  /**
   * Start stream-based monitoring (real-time)
   */
  async startStreamMonitoring() {
    try {
      const query = this.source.config?.query || this.source.target;

      // Validate query
      if (!query || query.trim().length === 0) {
        throw new Error('Twitter search query is empty');
      }

      // Validate query length (Twitter limits: 512 chars for Essential, 1024 for Academic)
      if (query.length > 512) {
        logger.warn(`Query length ${query.length} may exceed Twitter API limits (512 chars for Essential access)`);
      }

      logger.info(`Starting Twitter stream monitoring for: ${query}`);

      // Set up filtered stream rules
      const rules = await this.client.v2.streamRules();

      // Only delete rules for THIS source (filter by tag)
      if (rules && rules.data && Array.isArray(rules.data) && rules.data.length > 0) {
        const rulesToDelete = rules.data.filter(rule => rule.tag === this.source.id);
        if (rulesToDelete.length > 0) {
          await this.client.v2.updateStreamRules({
            delete: { ids: rulesToDelete.map(rule => rule.id) }
          });
          logger.debug(`Deleted ${rulesToDelete.length} existing rule(s) for ${this.source.id}`);
        }
      }

      // Add new rule for this source
      await this.client.v2.updateStreamRules({
        add: [{ value: query, tag: this.source.id }]
      });

      // Start streaming with proper field parameters (comma-separated strings, not arrays)
      this.stream = await this.client.v2.searchStream({
        'tweet.fields': 'created_at,author_id,text',
        'user.fields': 'username,name',
        expansions: 'author_id'
      });

      // Handle incoming tweets
      this.stream.on('data', (data) => this.handleTweet(data));

      // Handle stream errors
      this.stream.on('error', (error) => {
        logger.error(`Twitter stream error for ${this.source.id}: ${error.message}`);
        this.updateHealth('degraded', error.message);
      });

      // Handle stream connection errors
      this.stream.on('connection error', (error) => {
        logger.error(`Twitter stream connection error for ${this.source.id}: ${error.message}`);
        this.updateHealth('failed', 'Stream connection failed');
      });

      // Handle stream reconnections
      this.stream.on('reconnect', (reconnectCount) => {
        logger.info(`Twitter stream reconnecting for ${this.source.id} (attempt ${reconnectCount})`);
      });

      logger.info(`Twitter stream monitoring started for ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to start Twitter stream: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start polling-based monitoring (search API)
   */
  async startPollingMonitoring() {
    try {
      const query = this.source.config?.query || this.source.target;
      const pollIntervalSeconds = this.source.config?.poll_interval || 60;

      // Validate query
      if (!query || query.trim().length === 0) {
        throw new Error('Twitter search query is empty');
      }

      // Validate query length
      if (query.length > 512) {
        logger.warn(`Query length ${query.length} may exceed Twitter API limits (512 chars for Essential access)`);
      }

      // Validate poll interval
      if (pollIntervalSeconds <= 0) {
        throw new Error(`Invalid poll_interval: ${pollIntervalSeconds}. Must be positive number of seconds.`);
      }

      if (pollIntervalSeconds < 10) {
        logger.warn(`Poll interval ${pollIntervalSeconds}s is very short and may hit rate limits`);
      }

      const pollIntervalMs = pollIntervalSeconds * 1000;

      logger.info(`Starting Twitter polling monitoring for: ${query} (interval: ${pollIntervalSeconds}s)`);

      // Initial poll
      await this.pollTweets(query);

      // Set up polling interval
      this.pollInterval = setInterval(async () => {
        try {
          await this.pollTweets(query);
        } catch (error) {
          logger.error(`Twitter polling error for ${this.source.id}: ${error.message}`);
          this.updateHealth('degraded', error.message);
        }
      }, pollIntervalMs);

      this.polling = true;
      logger.info(`Twitter polling monitoring started for ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to start Twitter polling: ${error.message}`);
      throw error;
    }
  }

  /**
   * Poll for tweets
   */
  async pollTweets(query) {
    try {
      // Get cursor for pagination
      const cursor = await this.getCursor();

      // Validate and constrain max_results (Twitter API limits: 10-100 for search endpoint)
      let maxResults = this.source.config?.max_results || 10;
      if (maxResults < 10) maxResults = 10;
      if (maxResults > 100) maxResults = 100;

      // Build options object (twitter-api-v2 format)
      const options = {
        max_results: maxResults,
        'tweet.fields': 'created_at,author_id,text',
        'user.fields': 'username,name',
        expansions: 'author_id'
      };

      // Add since_id if we have a cursor
      if (cursor) {
        options.since_id = cursor;
      }

      // Call search with query as first param, options as second (twitter-api-v2 format)
      const tweets = await this.client.v2.search(query, options);

      // Validate response structure
      if (!tweets || typeof tweets !== 'object') {
        logger.warn(`Invalid response from Twitter API for ${this.source.id}`);
        return;
      }

      // Twitter API returns newest first by default
      // tweets.data.data contains array of tweet objects
      // tweets.includes.users contains user objects
      const tweetData = tweets.data?.data || [];
      const users = tweets.includes?.users || [];

      // Validate arrays
      if (!Array.isArray(tweetData)) {
        logger.error(`Expected tweetData to be array, got ${typeof tweetData}`);
        return;
      }

      if (!Array.isArray(users)) {
        logger.warn(`Expected users to be array, got ${typeof users}`);
      }

      // Create user map for quick lookup
      const userMap = {};
      if (Array.isArray(users)) {
        users.forEach(user => {
          if (user && user.id) {
            userMap[user.id] = user;
          }
        });
      }

      // Process each tweet (newest to oldest as returned by API)
      // IMPORTANT: Use await in loop to catch errors properly
      for (const tweet of tweetData) {
        if (!tweet || !tweet.id) {
          logger.debug(`Skipping invalid tweet object`);
          continue;
        }

        const user = userMap[tweet.author_id];
        if (user) {
          try {
            await this.handleTweet({ data: tweet, includes: { users: [user] } });
          } catch (handleError) {
            logger.error(`Error handling tweet ${tweet.id}: ${handleError.message}`);
            // Continue processing other tweets
          }
        } else {
          logger.debug(`No user data for tweet ${tweet.id}, author_id: ${tweet.author_id}`);
        }
      }

      // Update cursor to NEWEST tweet ID (first in array since API returns newest first)
      // This ensures next poll gets only tweets newer than this one
      if (tweetData.length > 0 && tweetData[0] && tweetData[0].id) {
        const newestTweetId = tweetData[0].id;
        await this.updateCursor(newestTweetId, newestTweetId);
      }

    } catch (error) {
      // Rate limit handling (twitter-api-v2 error structure)
      if (error.code === 429 || error.rateLimitError || error.rateLimit) {
        // twitter-api-v2 provides rateLimit info in error
        const resetTime = error.rateLimit?.reset;
        if (resetTime) {
          const waitMs = resetTime * 1000 - Date.now();
          logger.warn(`Twitter rate limit hit for ${this.source.id}, resets in ${Math.ceil(waitMs / 1000)}s`);
        } else {
          logger.warn(`Twitter rate limit hit for ${this.source.id}`);
        }
        this.updateHealth('degraded', 'Rate limit reached');
        // Don't throw - let polling continue after interval
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle incoming tweet
   */
  async handleTweet(tweetData) {
    try {
      // Validate tweetData structure
      if (!tweetData || typeof tweetData !== 'object') {
        logger.debug('Invalid tweetData object');
        return;
      }

      // Validate tweet object
      const tweet = tweetData.data;
      if (!tweet || typeof tweet !== 'object') {
        logger.debug('Invalid tweet.data object');
        return;
      }

      // Validate tweet ID
      if (!tweet.id) {
        logger.debug('Tweet missing ID');
        return;
      }

      // Skip if no text
      if (!tweet.text || typeof tweet.text !== 'string') {
        logger.debug(`Tweet ${tweet.id} has no text content`);
        return;
      }

      const tweetId = tweet.id;

      // Check deduplication
      if (this.isDuplicate(tweetId, this.seenMessages)) {
        return;
      }

      // Add to seen messages
      this.seenMessages.add(tweetId);

      // Validate and extract users array
      const users = (tweetData.includes && Array.isArray(tweetData.includes.users))
        ? tweetData.includes.users
        : [];

      // Get author info with safe fallback
      const author = users.find(u => u && u.id === tweet.author_id) || {
        id: tweet.author_id || 'unknown',
        username: tweet.author_id ? `user_${tweet.author_id}` : 'unknown',
        name: 'Unknown'
      };

      // Normalize message
      const normalizedMsg = this.normalizeMessage({
        id: tweetId,
        text: tweet.text,
        author: {
          id: String(author.id),
          username: author.username || 'unknown',
          displayName: author.name || author.username || 'Unknown'
        },
        timestamp: tweet.created_at || new Date().toISOString(),
        metadata: {
          tweetId: tweetId,
          authorId: author.id,
          authorUsername: author.username
        }
      });

      // Add to queue for LLM processing
      this.messageQueue.push(normalizedMsg);

      // Update cursor (batched in polling mode via pollTweets)
      // For stream mode, we update per tweet (less efficient but necessary)
      if (this.stream) {
        await this.updateCursor(tweetId, tweetId);
      }

      // Update source last_message_at
      const db = require('../db');
      try {
        await db.run(
          'UPDATE sources SET last_message_at = ? WHERE id = ?',
          [normalizedMsg.timestamp, this.source.id]
        );
      } catch (dbError) {
        logger.error(`Failed to update source last_message_at: ${dbError.message}`);
        // Don't throw - message is already queued
      }

      logger.debug(`Twitter message queued: ${this.source.id} - "${tweet.text.substring(0, 50)}..."`);

    } catch (error) {
      logger.error(`Error handling Twitter message: ${error.message}`);
      // Don't throw - continue processing other tweets
    }
  }

  /**
   * Get queued messages
   */
  async getMessages() {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  /**
   * Disconnect from Twitter
   */
  async disconnect() {
    try {
      // Stop stream if active
      if (this.stream) {
        try {
          // Remove all listeners first to prevent event handling during shutdown
          this.stream.removeAllListeners();

          // Destroy stream (more forceful than close)
          this.stream.destroy();
        } catch (streamError) {
          logger.debug(`Error closing stream: ${streamError.message}`);
        }
        this.stream = null;
      }

      // Stop polling if active
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
        this.polling = false;
      }

      logger.info(`Twitter source disconnected: ${this.source.id}`);
    } catch (error) {
      logger.error(`Error disconnecting Twitter: ${error.message}`);
    }
  }
}

module.exports = TwitterConnector;
