/**
 * Sources API Routes
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * GET /api/sources
 * List all sources
 */
router.get('/', async (req, res) => {
  try {
    const { tracker_id, platform, health } = req.query;

    let query = 'SELECT * FROM sources WHERE 1=1';
    const params = [];

    if (tracker_id) {
      query += ' AND tracker_id = ?';
      params.push(tracker_id);
    }

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    if (health) {
      query += ' AND health_status = ?';
      params.push(health);
    }

    query += ' ORDER BY created_at DESC';

    const sources = await db.query(query, params);

    const sourcesWithDetails = sources.map(source => ({
      ...source,
      config: JSON.parse(source.config)
    }));

    res.json({
      sources: sourcesWithDetails,
      total: sourcesWithDetails.length
    });

  } catch (error) {
    logger.error(`Error fetching sources: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/sources/:sourceId
 * Get specific source details
 */
router.get('/:sourceId', async (req, res) => {
  try {
    const { sourceId } = req.params;

    const source = await db.queryOne(
      'SELECT * FROM sources WHERE id = ?',
      [sourceId]
    );

    if (!source) {
      return res.status(404).json({ error: 'NotFound', message: 'Source not found' });
    }

    // Get cursor info
    const cursor = await db.queryOne(
      'SELECT * FROM cursors WHERE source_id = ?',
      [sourceId]
    );

    res.json({
      ...source,
      config: JSON.parse(source.config),
      cursor: cursor || null
    });

  } catch (error) {
    logger.error(`Error fetching source: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/sources/:sourceId/snapshot
 * Get current snapshot for source
 */
router.get('/:sourceId/snapshot', async (req, res) => {
  try {
    const { sourceId } = req.params;
    const bucket = req.query.bucket || '1min';

    const snapshot = await db.queryOne(
      `SELECT * FROM source_aggregates
       WHERE source_id = ? AND bucket = ?
       ORDER BY bucket_start DESC LIMIT 1`,
      [sourceId, bucket]
    );

    if (!snapshot) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'No data available for this source'
      });
    }

    res.json({
      source_id: sourceId,
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
        tags: JSON.parse(snapshot.tag_counts)
      }
    });

  } catch (error) {
    logger.error(`Error fetching source snapshot: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

module.exports = router;
