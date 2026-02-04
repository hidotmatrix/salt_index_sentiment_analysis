/**
 * Cleanup Manager
 * Manages periodic cleanup of old data
 */
const logger = require('./logger');
const db = require('../db');

class CleanupManager {
  constructor(config) {
    this.config = config;
    this.cleanupInterval = null;
  }

  /**
   * Start periodic cleanup
   */
  start() {
    logger.info('Starting cleanup manager...');

    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, 3600000); // 1 hour

    // Run initial cleanup after 5 minutes
    setTimeout(() => this.runCleanup(), 300000);

    logger.info('Cleanup manager started');
  }

  /**
   * Stop cleanup
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    logger.info('Cleanup manager stopped');
  }

  /**
   * Run all cleanup tasks
   */
  async runCleanup() {
    try {
      logger.info('Running scheduled cleanup...');

      await this.cleanupDebugTraces();
      await this.cleanupOldBatches();
      await this.cleanupOldAggregates();

      logger.info('Scheduled cleanup completed');

    } catch (error) {
      logger.error(`Error during cleanup: ${error.message}`);
    }
  }

  /**
   * Clean up old debug traces
   */
  async cleanupDebugTraces() {
    // Read from TOML config with fallback to env
    const retentionDays = this.config.toml?.retention?.debug_traces_days
      || this.config.env.debug.traceRetentionDays
      || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db.run(
      'DELETE FROM debug_traces WHERE timestamp < ?',
      [cutoffDate.toISOString()]
    );

    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} old debug traces (older than ${retentionDays} days)`);
    }
  }

  /**
   * Clean up old batch logs
   */
  async cleanupOldBatches() {
    // Read from TOML config with fallback
    const retentionDays = this.config.toml?.retention?.llm_batch_logs_days || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db.run(
      'DELETE FROM llm_batch_log WHERE batch_timestamp < ?',
      [cutoffDate.toISOString()]
    );

    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} old batch logs (older than ${retentionDays} days)`);
    }
  }

  /**
   * Clean up old time bucket aggregates
   */
  async cleanupOldAggregates() {
    // Default retention periods (fallback if not in TOML)
    const defaultRetention = {
      '1min': 7,
      '5min': 30,
      '1hour': 90,
      '1day': 365
    };

    // Read from TOML config with fallback to defaults
    const configuredRetention = this.config.toml?.retention?.buckets || {};
    const retentionPeriods = { ...defaultRetention, ...configuredRetention };

    for (const [bucket, retentionDays] of Object.entries(retentionPeriods)) {
      if (retentionDays === 0) {
        continue; // Skip if retention is infinite
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Clean tracker aggregates
      const trackerResult = await db.run(
        'DELETE FROM tracker_aggregates WHERE bucket = ? AND bucket_start < ?',
        [bucket, cutoffDate.toISOString()]
      );

      // Clean source aggregates
      const sourceResult = await db.run(
        'DELETE FROM source_aggregates WHERE bucket = ? AND bucket_start < ?',
        [bucket, cutoffDate.toISOString()]
      );

      const totalCleaned = trackerResult.changes + sourceResult.changes;

      if (totalCleaned > 0) {
        logger.info(`Cleaned up ${totalCleaned} old ${bucket} aggregates (older than ${retentionDays} days)`);
      }
    }
  }

  /**
   * Optimize database (vacuum)
   */
  async optimizeDatabase() {
    try {
      logger.info('Running database optimization (VACUUM)...');
      await db.run('VACUUM');
      logger.info('Database optimization completed');
    } catch (error) {
      logger.error(`Error optimizing database: ${error.message}`);
    }
  }
}

module.exports = CleanupManager;
