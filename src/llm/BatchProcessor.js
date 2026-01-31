/**
 * Batch Processor
 * Batches messages and sends to LLM for processing
 */
const OpenRouterClient = require('./OpenRouterClient');
const logger = require('../utils/logger');
const db = require('../db');

class BatchProcessor {
  constructor(config) {
    this.config = config;
    this.llmClient = new OpenRouterClient(config.env.openrouter);
    this.batchSize = config.env.batch.size;
    this.batchTimeout = config.env.batch.timeout * 1000; // Convert to ms
    this.messageQueue = [];
    this.processing = false;
    this.processingInterval = null;
  }

  /**
   * Start batch processing
   */
  start() {
    logger.info('Starting batch processor...');

    // Process batches every 10 seconds
    this.processingInterval = setInterval(() => {
      this.processBatches();
    }, 10000);

    logger.info('Batch processor started');
  }

  /**
   * Stop batch processing
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    logger.info('Batch processor stopped');
  }

  /**
   * Add messages to queue
   */
  queueMessages(messages) {
    this.messageQueue.push(...messages);
    logger.debug(`Queued ${messages.length} messages. Total in queue: ${this.messageQueue.length}`);
  }

  /**
   * Process batches
   */
  async processBatches() {
    if (this.processing) {
      return;
    }

    if (this.messageQueue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      // Group messages by tracker
      const byTracker = this.groupByTracker(this.messageQueue);

      for (const [trackerId, messages] of Object.entries(byTracker)) {
        // Process in batches
        while (messages.length > 0) {
          const batch = messages.splice(0, this.batchSize);
          await this.processBatch(trackerId, batch);
        }
      }

      // Clear processed messages
      this.messageQueue = [];

    } catch (error) {
      logger.error(`Error processing batches: ${error.message}`);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Group messages by tracker
   */
  groupByTracker(messages) {
    const grouped = {};

    for (const msg of messages) {
      if (!grouped[msg.trackerId]) {
        grouped[msg.trackerId] = [];
      }
      grouped[msg.trackerId].push(msg);
    }

    return grouped;
  }

  /**
   * Process a single batch
   */
  async processBatch(trackerId, messages) {
    try {
      logger.info(`Processing batch for tracker ${trackerId}: ${messages.length} messages`);

      // Get tracker config
      const tracker = await this.getTrackerConfig(trackerId);
      if (!tracker) {
        logger.error(`Tracker not found: ${trackerId}`);
        return;
      }

      // Call LLM
      const result = await this.llmClient.analyzeBatch(
        messages,
        tracker.enabledTags,
        tracker.excludedFromSentiment
      );

      // Log to database
      await this.logBatch(trackerId, messages, result, true);

      // Send to aggregation engine
      const aggregationEngine = require('../aggregation/AggregationEngine');
      await aggregationEngine.processLLMResult(trackerId, messages, result);

      // Upsert users
      await this.upsertUsers(messages, result.perUser);

      logger.info(`Batch processed successfully for tracker ${trackerId}`);

    } catch (error) {
      logger.error(`Failed to process batch for tracker ${trackerId}: ${error.message}`);

      // Log failed batch
      await this.logBatch(trackerId, messages, null, false, error.message);
    }
  }

  /**
   * Get tracker configuration
   */
  async getTrackerConfig(trackerId) {
    const row = await db.queryOne(
      'SELECT * FROM trackers WHERE id = ?',
      [trackerId]
    );

    if (!row) return null;

    return {
      id: row.id,
      enabledTags: JSON.parse(row.enabled_tags),
      excludedFromSentiment: JSON.parse(row.excluded_from_sentiment)
    };
  }

  /**
   * Log batch to database
   */
  async logBatch(trackerId, messages, result, success, errorMessage = null) {
    const sourceIds = [...new Set(messages.map(m => m.sourceId))];

    await db.run(
      `INSERT INTO llm_batch_log (
        tracker_id, message_count, source_ids, success,
        sentiment_score, author_count, tag_counts,
        processing_time_ms, tokens_used, cost_usd,
        error_message, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trackerId,
        messages.length,
        JSON.stringify(sourceIds),
        success ? 1 : 0,
        result ? result.sentimentScore : null,
        result ? result.authorCount : null,
        result ? JSON.stringify(result.tagCounts) : null,
        result ? result.processingTime : null,
        result ? result.tokensUsed : null,
        result ? this.calculateCost(result.tokensUsed) : null,
        errorMessage,
        0
      ]
    );
  }

  /**
   * Calculate cost (rough estimate)
   */
  calculateCost(tokens) {
    // Rough estimate: $0.002 per 1K tokens
    return (tokens / 1000) * 0.002;
  }

  /**
   * Upsert users from batch
   */
  async upsertUsers(messages, perUserResults) {
    for (const msg of messages) {
      const userId = `${msg.platform}:${msg.author.id}`;

      await db.run(
        `INSERT INTO users (id, platform, platform_user_id, username, display_name, first_seen_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           display_name = excluded.display_name,
           last_active_at = excluded.last_active_at`,
        [
          userId,
          msg.platform,
          msg.author.id,
          msg.author.username,
          msg.author.displayName,
          msg.timestamp,
          msg.timestamp
        ]
      );
    }
  }
}

module.exports = BatchProcessor;
