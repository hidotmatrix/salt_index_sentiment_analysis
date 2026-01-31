/**
 * Trackers API Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * GET /api/trackers
 * List all trackers
 */
router.get('/', async (req, res) => {
  try {
    const trackers = await db.query('SELECT * FROM trackers ORDER BY created_at DESC');

    const trackersWithDetails = await Promise.all(trackers.map(async (tracker) => {
      // Get source count
      const sourcesCount = await db.queryOne(
        'SELECT COUNT(*) as count FROM sources WHERE tracker_id = ?',
        [tracker.id]
      );

      // Get health status
      const sources = await db.query(
        'SELECT health_status FROM sources WHERE tracker_id = ?',
        [tracker.id]
      );

      const healthCounts = {
        healthy: 0,
        degraded: 0,
        failed: 0
      };

      sources.forEach(s => {
        if (healthCounts[s.health_status] !== undefined) {
          healthCounts[s.health_status]++;
        }
      });

      return {
        ...tracker,
        enabled_tags: JSON.parse(tracker.enabled_tags),
        excluded_from_sentiment: JSON.parse(tracker.excluded_from_sentiment),
        time_buckets: JSON.parse(tracker.time_buckets),
        source_count: sourcesCount.count,
        health: {
          status: healthCounts.failed > 0 ? 'degraded' : 'healthy',
          healthy_sources: healthCounts.healthy,
          degraded_sources: healthCounts.degraded,
          failed_sources: healthCounts.failed
        }
      };
    }));

    res.json({
      trackers: trackersWithDetails,
      total: trackersWithDetails.length
    });

  } catch (error) {
    logger.error(`Error fetching trackers: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/trackers/:trackerId
 * Get specific tracker details
 */
router.get('/:trackerId', async (req, res) => {
  try {
    const { trackerId } = req.params;

    const tracker = await db.queryOne(
      'SELECT * FROM trackers WHERE id = ?',
      [trackerId]
    );

    if (!tracker) {
      return res.status(404).json({ error: 'NotFound', message: 'Tracker not found' });
    }

    // Get sources
    const sources = await db.query(
      'SELECT * FROM sources WHERE tracker_id = ?',
      [trackerId]
    );

    // Get statistics
    const stats = await db.queryOne(
      `SELECT
        SUM(message_count) as total_messages,
        COUNT(DISTINCT bucket_start) as data_points
      FROM tracker_aggregates
      WHERE tracker_id = ?`,
      [trackerId]
    );

    res.json({
      ...tracker,
      enabled_tags: JSON.parse(tracker.enabled_tags),
      excluded_from_sentiment: JSON.parse(tracker.excluded_from_sentiment),
      time_buckets: JSON.parse(tracker.time_buckets),
      sources: sources.map(s => ({
        ...s,
        config: JSON.parse(s.config)
      })),
      statistics: {
        total_messages_processed: stats?.total_messages || 0,
        data_points: stats?.data_points || 0
      }
    });

  } catch (error) {
    logger.error(`Error fetching tracker: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/trackers/:trackerId/snapshot
 * Get current snapshot for tracker
 */
router.get('/:trackerId/snapshot', async (req, res) => {
  try {
    const { trackerId } = req.params;
    const bucket = req.query.bucket || '1min';

    const snapshot = await db.queryOne(
      `SELECT * FROM tracker_aggregates
       WHERE tracker_id = ? AND bucket = ?
       ORDER BY bucket_start DESC LIMIT 1`,
      [trackerId, bucket]
    );

    if (!snapshot) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'No data available for this tracker'
      });
    }

    res.json({
      tracker_id: trackerId,
      timestamp: new Date().toISOString(),
      bucket: bucket,
      window: {
        start: snapshot.bucket_start,
        end: snapshot.bucket_end
      },
      metrics: {
        sentiment: {
          score: snapshot.sentiment_score
        },
        volume: {
          message_count: snapshot.message_count,
          author_count: snapshot.author_count
        },
        tags: JSON.parse(snapshot.tag_counts),
        sources: JSON.parse(snapshot.source_contributions)
      }
    });

  } catch (error) {
    logger.error(`Error fetching snapshot: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/trackers/:trackerId/timeseries
 * Get time-series data for tracker
 */
router.get('/:trackerId/timeseries', async (req, res) => {
  try {
    const { trackerId } = req.params;
    const { bucket, from, to } = req.query;

    if (!bucket || !from) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'bucket and from parameters are required'
      });
    }

    const toDate = to || new Date().toISOString();

    const series = await db.query(
      `SELECT * FROM tracker_aggregates
       WHERE tracker_id = ? AND bucket = ?
       AND bucket_start >= ? AND bucket_start <= ?
       ORDER BY bucket_start ASC`,
      [trackerId, bucket, from, toDate]
    );

    const dataPoints = series.map(point => ({
      timestamp: point.bucket_start,
      window: {
        start: point.bucket_start,
        end: point.bucket_end
      },
      sentiment: point.sentiment_score,
      message_count: point.message_count,
      author_count: point.author_count,
      tags: JSON.parse(point.tag_counts)
    }));

    res.json({
      tracker_id: trackerId,
      bucket: bucket,
      window: {
        from: from,
        to: toDate
      },
      data_points: dataPoints.length,
      series: dataPoints
    });

  } catch (error) {
    logger.error(`Error fetching timeseries: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

module.exports = router;
