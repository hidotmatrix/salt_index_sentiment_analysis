/**
 * Admin API Routes
 * Admin-only endpoints for system management
 */
const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const configLoader = require('../../config/loader');

// Admin-only middleware - all routes in this file require admin permissions
router.use((req, res, next) => {
  if (!req.user || req.user.type !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin permissions required for this endpoint'
    });
  }
  next();
});

/**
 * POST /api/admin/reload-config
 * Reload configuration from config.toml (admin only)
 */
router.post('/reload-config', async (req, res) => {
  try {
    logger.info('Configuration reload requested');

    const db = require('../../db');

    // Get current tracker tags before reload
    const oldTrackers = await db.query('SELECT id, enabled_tags FROM trackers');
    const oldTagMap = {};
    oldTrackers.forEach(t => {
      oldTagMap[t.id] = JSON.parse(t.enabled_tags);
    });

    // Reload TOML configuration
    configLoader.loadToml();
    configLoader.validate();

    // Get the new config
    const newConfig = configLoader.getConfig();

    // Initialize database from new config
    const initializeFromConfig = require('../../utils/initializeFromConfig');
    await initializeFromConfig();

    // Check for tag changes
    const warnings = [];
    if (newConfig.toml.trackers) {
      for (const tracker of newConfig.toml.trackers) {
        const oldTags = oldTagMap[tracker.id];
        if (oldTags) {
          const newTags = tracker.enabled_tags || [];

          // Check if tags changed
          const oldSet = new Set(oldTags);
          const newSet = new Set(newTags);

          const added = newTags.filter(t => !oldSet.has(t));
          const removed = oldTags.filter(t => !newSet.has(t));

          if (added.length > 0 || removed.length > 0) {
            warnings.push({
              tracker_id: tracker.id,
              tags_added: added,
              tags_removed: removed,
              warning: 'HISTORICAL DISTORTION: Changing enabled tags affects interpretation of past data. Historical aggregates remain unchanged but may no longer match current tag configuration.'
            });
          }
        }
      }
    }

    logger.info('Configuration reloaded successfully');

    if (warnings.length > 0) {
      logger.warn(`Tag changes detected in ${warnings.length} tracker(s)`);
    }

    res.json({
      message: 'Configuration reloaded successfully',
      timestamp: new Date().toISOString(),
      config: {
        trackers: newConfig.toml.trackers?.length || 0,
        sources: newConfig.toml.sources?.length || 0
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      note: 'Note: Connector changes require service restart to take effect. Tracker and tag changes are applied immediately.'
    });

  } catch (error) {
    logger.error(`Error reloading configuration: ${error.message}`);
    res.status(500).json({
      error: 'InternalServerError',
      message: `Failed to reload configuration: ${error.message}`
    });
  }
});

/**
 * GET /api/admin/stats
 * Get system statistics (admin only)
 */
router.get('/stats', async (req, res) => {
  try {
    const db = require('../../db');

    // Get database statistics
    const [
      totalTrackers,
      totalSources,
      totalUsers,
      totalMessages,
      totalBatches,
      dbSize
    ] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as count FROM trackers'),
      db.queryOne('SELECT COUNT(*) as count FROM sources'),
      db.queryOne('SELECT COUNT(*) as count FROM users'),
      db.queryOne('SELECT SUM(message_count) as count FROM tracker_aggregates'),
      db.queryOne('SELECT COUNT(*) as count FROM llm_batch_log'),
      db.queryOne("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
    ]);

    // Get queue stats if batch processor is available
    const expressApp = require('../app');
    const batchProcessor = expressApp.getBatchProcessor();
    let queueStats = null;

    if (batchProcessor) {
      queueStats = batchProcessor.getQueueStats();
    }

    res.json({
      timestamp: new Date().toISOString(),
      database: {
        trackers: totalTrackers.count,
        sources: totalSources.count,
        users: totalUsers.count,
        total_messages_processed: totalMessages.count || 0,
        total_batches: totalBatches.count,
        size_bytes: dbSize.size,
        size_mb: (dbSize.size / 1024 / 1024).toFixed(2)
      },
      queue: queueStats,
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage()
    });

  } catch (error) {
    logger.error(`Error fetching stats: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * POST /api/admin/cleanup
 * Run cleanup tasks (admin only)
 */
router.post('/cleanup', async (req, res) => {
  try {
    const db = require('../../db');
    const { target } = req.body;

    if (!target || !['debug_traces', 'old_batches', 'all'].includes(target)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'target must be one of: debug_traces, old_batches, all'
      });
    }

    const results = {};

    if (target === 'debug_traces' || target === 'all') {
      // Clean debug traces older than retention period
      const retentionDays = parseInt(process.env.DEBUG_TRACE_RETENTION_DAYS) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await db.run(
        'DELETE FROM debug_traces WHERE timestamp < ?',
        [cutoffDate.toISOString()]
      );

      results.debug_traces = {
        deleted: result.changes,
        retention_days: retentionDays
      };
    }

    if (target === 'old_batches' || target === 'all') {
      // Clean old batch logs (keep last 90 days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);

      const result = await db.run(
        'DELETE FROM llm_batch_log WHERE batch_timestamp < ?',
        [cutoffDate.toISOString()]
      );

      results.old_batches = {
        deleted: result.changes,
        retention_days: 90
      };
    }

    logger.info(`Cleanup completed: ${JSON.stringify(results)}`);

    res.json({
      message: 'Cleanup completed successfully',
      timestamp: new Date().toISOString(),
      results
    });

  } catch (error) {
    logger.error(`Error running cleanup: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

module.exports = router;
