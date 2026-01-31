/**
 * Dashboard API Route
 * Provides aggregated data for the monitoring dashboard
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * GET /api/dashboard
 * Get all dashboard data in one call
 */
router.get('/', async (req, res) => {
  try {
    // Get all sources with their status
    const sources = await db.query(
      `SELECT id, platform, target, health_status, last_message_at,
              paused, created_at
       FROM sources
       ORDER BY platform, created_at`
    );

    // Get message count for today per source
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const messageCounts = await db.query(
      `SELECT source_id, SUM(message_count) as count
       FROM source_aggregates
       WHERE bucket_start >= ?
       GROUP BY source_id`,
      [today.toISOString()]
    );

    const messageCountMap = {};
    messageCounts.forEach(row => {
      messageCountMap[row.source_id] = row.count;
    });

    // Get latest sentiment from tracker aggregates
    const latestSentiment = await db.queryOne(
      `SELECT sentiment_score, message_count, author_count,
              bucket_start, tag_counts
       FROM tracker_aggregates
       WHERE bucket = '1min'
       ORDER BY bucket_start DESC
       LIMIT 1`
    );

    // Get recent batch logs (last 20 processed batches)
    const recentBatches = await db.query(
      `SELECT tracker_id, message_count, batch_timestamp,
              processing_time_ms, success
       FROM llm_batch_log
       ORDER BY batch_timestamp DESC
       LIMIT 20`
    );

    // All available platforms
    const allPlatforms = ['telegram', 'discord', 'twitter'];

    // Map existing sources by platform
    const sourcesByPlatform = {};
    sources.forEach(source => {
      if (!sourcesByPlatform[source.platform]) {
        sourcesByPlatform[source.platform] = [];
      }
      sourcesByPlatform[source.platform].push({
        ...source,
        messages_today: messageCountMap[source.id] || 0,
        connected: !source.paused && source.health_status !== 'failed'
      });
    });

    // Build complete platform list (configured + unconfigured)
    const allSources = allPlatforms.map(platform => {
      const configured = sourcesByPlatform[platform];
      if (configured && configured.length > 0) {
        // Return first configured source for this platform
        return configured[0];
      } else {
        // Return placeholder for unconfigured platform
        return {
          platform: platform,
          target: null,
          connected: false,
          configured: false,
          messages_today: 0
        };
      }
    });

    // Calculate stats
    const connectedSources = allSources.filter(s => s.connected).length;
    const totalMessagesToday = Object.values(messageCountMap).reduce((sum, count) => sum + count, 0);

    res.json({
      timestamp: new Date().toISOString(),
      system: {
        total_platforms: allPlatforms.length,
        connected: connectedSources,
        not_connected: allPlatforms.length - connectedSources,
        messages_today: totalMessagesToday
      },
      sentiment: latestSentiment ? {
        score: latestSentiment.sentiment_score,
        message_count: latestSentiment.message_count,
        author_count: latestSentiment.author_count,
        timestamp: latestSentiment.bucket_start,
        tags: JSON.parse(latestSentiment.tag_counts || '{}')
      } : null,
      sources: allSources,
      recent_batches: recentBatches.map(batch => ({
        tracker_id: batch.tracker_id,
        message_count: batch.message_count,
        processed_at: batch.batch_timestamp,
        processing_time_ms: batch.processing_time_ms,
        success: Boolean(batch.success)
      }))
    });

  } catch (error) {
    logger.error(`Error fetching dashboard data: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

module.exports = router;
