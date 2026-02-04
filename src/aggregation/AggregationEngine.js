/**
 * Aggregation Engine
 * Aggregates sentiment data at Source, Tracker, and User levels
 */
const logger = require('../utils/logger');
const db = require('../db');

class AggregationEngine {
  constructor() {
    // Default time buckets (fallback only)
    this.defaultTimeBuckets = ['1min', '5min', '1hour', '1day', '7day'];
  }

  /**
   * Get time buckets for a tracker from database
   */
  async getTrackerTimeBuckets(trackerId) {
    const tracker = await db.queryOne(
      'SELECT time_buckets FROM trackers WHERE id = ?',
      [trackerId]
    );

    if (tracker && tracker.time_buckets) {
      const buckets = JSON.parse(tracker.time_buckets);
      return buckets.length > 0 ? buckets : this.defaultTimeBuckets;
    }

    logger.warn(`No time_buckets config for tracker ${trackerId}, using defaults`);
    return this.defaultTimeBuckets;
  }

  /**
   * Process LLM result and create aggregates
   */
  async processLLMResult(trackerId, messages, llmResult) {
    try {
      logger.info(`Creating aggregates for tracker ${trackerId}`);

      // Get time buckets from tracker configuration
      const timeBuckets = await this.getTrackerTimeBuckets(trackerId);

      // Group messages by source
      const bySource = this.groupBySource(messages);

      // Create source-level aggregates
      for (const [sourceId, sourceMessages] of Object.entries(bySource)) {
        await this.createSourceAggregates(sourceId, trackerId, sourceMessages, llmResult, timeBuckets);
      }

      // Create tracker-level aggregates
      await this.createTrackerAggregates(trackerId, messages, llmResult, timeBuckets);

      // Create user-level aggregates
      await this.createUserAggregates(trackerId, llmResult.perUser);

      logger.info(`Aggregates created successfully for tracker ${trackerId}`);

    } catch (error) {
      logger.error(`Failed to create aggregates: ${error.message}`);
      throw error;
    }
  }

  /**
   * Group messages by source
   */
  groupBySource(messages) {
    const grouped = {};

    for (const msg of messages) {
      if (!grouped[msg.sourceId]) {
        grouped[msg.sourceId] = [];
      }
      grouped[msg.sourceId].push(msg);
    }

    return grouped;
  }

  /**
   * Create source-level aggregates
   */
  async createSourceAggregates(sourceId, trackerId, messages, llmResult, timeBuckets) {
    const now = new Date();

    // Calculate per-source metrics (proportional to message count)
    const sourceMessageCount = messages.length;
    const totalMessageCount = llmResult.messageCount;
    const proportion = sourceMessageCount / totalMessageCount;

    const sourceSentiment = llmResult.sentimentScore * proportion;
    const sourceAuthorCount = new Set(messages.map(m => m.author.id)).size;

    // Proportional tag counts
    const sourceTagCounts = {};
    for (const [tag, count] of Object.entries(llmResult.tagCounts)) {
      sourceTagCounts[tag] = Math.round(count * proportion);
    }

    // Create aggregates for each time bucket
    for (const bucket of timeBuckets) {
      const { bucketStart, bucketEnd } = this.getTimeBucket(now, bucket);

      await db.run(
        `INSERT INTO source_aggregates (
          source_id, tracker_id, bucket, bucket_start, bucket_end,
          sentiment_score, message_count, author_count, tag_counts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, bucket, bucket_start) DO UPDATE SET
          sentiment_score = ((sentiment_score * message_count) + (? * ?)) / (message_count + ?),
          message_count = message_count + ?,
          author_count = MAX(author_count, ?),
          tag_counts = json_patch(tag_counts, ?)`,
        [
          sourceId, trackerId, bucket,
          bucketStart.toISOString(),
          bucketEnd.toISOString(),
          sourceSentiment,
          sourceMessageCount,
          sourceAuthorCount,
          JSON.stringify(sourceTagCounts),
          // Update params
          sourceSentiment,
          sourceMessageCount,
          sourceMessageCount,
          sourceMessageCount,
          sourceAuthorCount,
          JSON.stringify(sourceTagCounts)
        ]
      );
    }
  }

  /**
   * Create tracker-level aggregates
   */
  async createTrackerAggregates(trackerId, messages, llmResult, timeBuckets) {
    const now = new Date();

    // Get source weights
    const sourceWeights = await this.getSourceWeights(trackerId);

    // Calculate weighted sentiment
    const bySource = this.groupBySource(messages);
    let weightedSentiment = 0;
    let totalWeight = 0;

    for (const [sourceId, sourceMessages] of Object.entries(bySource)) {
      const weight = sourceWeights[sourceId] || 1.0;
      const proportion = sourceMessages.length / messages.length;
      weightedSentiment += llmResult.sentimentScore * proportion * weight;
      totalWeight += weight * proportion;
    }

    const finalSentiment = totalWeight > 0 ? weightedSentiment / totalWeight : llmResult.sentimentScore;

    // Build source contributions
    const sourceContributions = [];
    for (const [sourceId, sourceMessages] of Object.entries(bySource)) {
      sourceContributions.push({
        source_id: sourceId,
        weight: sourceWeights[sourceId] || 1.0,
        sentiment: llmResult.sentimentScore,
        message_count: sourceMessages.length,
        contribution: sourceMessages.length / messages.length
      });
    }

    // Create aggregates for each time bucket
    for (const bucket of timeBuckets) {
      const { bucketStart, bucketEnd } = this.getTimeBucket(now, bucket);

      await db.run(
        `INSERT INTO tracker_aggregates (
          tracker_id, bucket, bucket_start, bucket_end,
          sentiment_score, message_count, author_count,
          tag_counts, source_contributions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tracker_id, bucket, bucket_start) DO UPDATE SET
          sentiment_score = ((sentiment_score * message_count) + (? * ?)) / (message_count + ?),
          message_count = message_count + ?,
          author_count = MAX(author_count, ?),
          tag_counts = json_patch(tag_counts, ?),
          source_contributions = ?`,
        [
          trackerId, bucket,
          bucketStart.toISOString(),
          bucketEnd.toISOString(),
          finalSentiment,
          llmResult.messageCount,
          llmResult.authorCount,
          JSON.stringify(llmResult.tagCounts),
          JSON.stringify(sourceContributions),
          // Update params
          finalSentiment,
          llmResult.messageCount,
          llmResult.messageCount,
          llmResult.messageCount,
          llmResult.authorCount,
          JSON.stringify(llmResult.tagCounts),
          JSON.stringify(sourceContributions)
        ]
      );
    }
  }

  /**
   * Create user-level aggregates
   */
  async createUserAggregates(trackerId, perUserResults) {
    for (const user of perUserResults) {
      const userId = user.user_id;

      // Ensure user exists in users table first (to satisfy foreign key)
      await this.ensureUserExists(userId, user);

      // Get existing aggregate or create new
      const existing = await db.queryOne(
        'SELECT * FROM user_aggregates WHERE user_id = ? AND tracker_id = ?',
        [userId, trackerId]
      );

      if (existing) {
        // Update existing
        const newTotalMessages = existing.total_messages + user.message_count;
        const newAvgSentiment = Math.round(
          ((existing.avg_sentiment * existing.total_messages) +
           (user.sentiment_avg * user.message_count)) / newTotalMessages
        );

        // Merge tag counts
        const existingTags = JSON.parse(existing.tag_counts);
        const mergedTags = { ...existingTags };
        for (const [tag, count] of Object.entries(user.tags)) {
          mergedTags[tag] = (mergedTags[tag] || 0) + count;
        }

        await db.run(
          `UPDATE user_aggregates SET
            total_messages = ?,
            avg_sentiment = ?,
            tag_counts = ?,
            last_message_at = ?,
            updated_at = ?
          WHERE user_id = ? AND tracker_id = ?`,
          [
            newTotalMessages,
            newAvgSentiment,
            JSON.stringify(mergedTags),
            new Date().toISOString(),
            new Date().toISOString(),
            userId,
            trackerId
          ]
        );

      } else {
        // Insert new
        await db.run(
          `INSERT INTO user_aggregates (
            user_id, tracker_id, total_messages, avg_sentiment,
            tag_counts, first_message_at, last_message_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            trackerId,
            user.message_count,
            user.sentiment_avg,
            JSON.stringify(user.tags),
            new Date().toISOString(),
            new Date().toISOString()
          ]
        );
      }
    }
  }

  /**
   * Ensure user exists in users table
   */
  async ensureUserExists(userId, userInfo) {
    // User ID format: platform:platform_user_id (e.g., "telegram:123456")
    const [platform, platformUserId] = userId.split(':', 2);

    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO users (
        id, platform, platform_user_id, username, display_name,
        first_seen_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_user_id) DO UPDATE SET
        last_active_at = ?,
        username = COALESCE(?, username),
        display_name = COALESCE(?, display_name)`,
      [
        userId,
        platform,
        platformUserId,
        userInfo.username || null,
        userInfo.display_name || null,
        now,
        now,
        // Update params
        now,
        userInfo.username || null,
        userInfo.display_name || null
      ]
    );
  }

  /**
   * Get source weights for a tracker
   */
  async getSourceWeights(trackerId) {
    const sources = await db.query(
      'SELECT id, weight FROM sources WHERE tracker_id = ?',
      [trackerId]
    );

    const weights = {};
    for (const source of sources) {
      weights[source.id] = source.weight;
    }

    return weights;
  }

  /**
   * Get time bucket boundaries
   * Supports dynamic bucket formats: Xmin, Xhour, Xday (e.g., "1min", "5min", "1hour", "8day")
   */
  getTimeBucket(timestamp, bucket) {
    const date = new Date(timestamp);
    let bucketStart, bucketEnd;

    // Parse bucket format: number + unit (e.g., "5min", "1hour", "7day")
    const match = bucket.match(/^(\d+)(min|hour|day)$/);
    if (!match) {
      throw new Error(`Invalid bucket format: ${bucket}. Expected format: Xmin, Xhour, or Xday`);
    }

    const num = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'min':
        // Round down to nearest bucket interval
        const mins = Math.floor(date.getMinutes() / num) * num;
        bucketStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), mins, 0);
        bucketEnd = new Date(bucketStart.getTime() + num * 60000);
        break;

      case 'hour':
        const hours = Math.floor(date.getHours() / num) * num;
        bucketStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, 0, 0);
        bucketEnd = new Date(bucketStart.getTime() + num * 3600000);
        break;

      case 'day':
        // For multi-day buckets, align to start of week (Sunday) then offset
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
        const bucketDayStart = Math.floor(dayOfYear / num) * num;
        const yearStart = new Date(date.getFullYear(), 0, 1);
        bucketStart = new Date(yearStart.getTime() + (bucketDayStart - 1) * 86400000);
        bucketStart.setHours(0, 0, 0, 0);
        bucketEnd = new Date(bucketStart.getTime() + num * 86400000);
        break;

      default:
        throw new Error(`Unknown bucket unit: ${unit}`);
    }

    return { bucketStart, bucketEnd };
  }
}

// Export singleton
module.exports = new AggregationEngine();
