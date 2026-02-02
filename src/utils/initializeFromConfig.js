/**
 * Initialize database from config.toml
 * Populates trackers and sources tables
 */
const db = require('../db');
const configLoader = require('../config/loader');
const logger = require('./logger');

async function initializeFromConfig() {
  try {
    logger.info('Initializing database from config.toml...');

    const config = configLoader.load();

    if (!config.toml || !config.toml.trackers) {
      logger.warn('No trackers found in config.toml');
      return;
    }

    // Get default settings
    const defaults = config.toml.default_settings || {};
    const defaultExcludedFromSentiment = defaults.excluded_from_sentiment || ['spam', 'bot', 'scam', 'phishing'];

    // Insert/update trackers (preserve existing data)
    for (const tracker of config.toml.trackers) {
      const result = await db.run(
        `INSERT OR IGNORE INTO trackers (
          id, name, description, enabled,
          enabled_tags, excluded_from_sentiment, time_buckets
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tracker.id,
          tracker.name,
          tracker.description || '',
          tracker.enabled ? 1 : 0,
          JSON.stringify(tracker.enabled_tags),
          JSON.stringify(tracker.excluded_from_sentiment || defaultExcludedFromSentiment),
          JSON.stringify(tracker.time_buckets)
        ]
      );

      if (result.changes > 0) {
        logger.info(`Tracker inserted: ${tracker.id}`);
      } else {
        // Tracker exists, update config
        await db.run(
          `UPDATE trackers SET
            name = ?, description = ?, enabled = ?,
            enabled_tags = ?, excluded_from_sentiment = ?, time_buckets = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            tracker.name,
            tracker.description || '',
            tracker.enabled ? 1 : 0,
            JSON.stringify(tracker.enabled_tags),
            JSON.stringify(tracker.excluded_from_sentiment || defaultExcludedFromSentiment),
            JSON.stringify(tracker.time_buckets),
            tracker.id
          ]
        );
        logger.info(`Tracker updated: ${tracker.id}`);
      }
    }

    // Insert sources (use INSERT OR IGNORE to preserve cursors on restart)
    if (config.toml.sources) {
      for (const source of config.toml.sources) {
        // First try to insert (only if not exists)
        const result = await db.run(
          `INSERT OR IGNORE INTO sources (
            id, tracker_id, platform, target, config, weight, paused
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            source.id,
            source.tracker_id,
            source.platform,
            source.target,
            JSON.stringify(source.config || {}),
            source.weight || 1.0,
            source.paused ? 1 : 0
          ]
        );

        if (result.changes > 0) {
          logger.info(`Source inserted: ${source.id}`);
        } else {
          // Source exists, update config fields but preserve cursor-related data
          await db.run(
            `UPDATE sources SET
              tracker_id = ?, platform = ?, target = ?, config = ?, weight = ?, paused = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [
              source.tracker_id,
              source.platform,
              source.target,
              JSON.stringify(source.config || {}),
              source.weight || 1.0,
              source.paused ? 1 : 0,
              source.id
            ]
          );
          logger.info(`Source updated (cursor preserved): ${source.id}`);
        }
      }
    }

    logger.info('✅ Database initialized from config!');
  } catch (error) {
    logger.error(`Failed to initialize from config: ${error.message}`);
    throw error;
  }
}

module.exports = initializeFromConfig;
