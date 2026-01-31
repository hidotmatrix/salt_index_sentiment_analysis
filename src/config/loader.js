/**
 * Configuration Loader
 * Loads environment variables and TOML configuration
 */
const fs = require('fs');
const path = require('path');
const toml = require('@iarna/toml');
require('dotenv').config();

const logger = require('../utils/logger');

class ConfigLoader {
  constructor() {
    this.envConfig = null;
    this.tomlConfig = null;
  }

  /**
   * Load all configuration
   */
  load() {
    logger.info('Loading configuration...');

    // Load environment variables
    this.loadEnv();

    // Load TOML configuration
    this.loadToml();

    logger.info('Configuration loaded successfully');
    return this.getConfig();
  }

  /**
   * Load and validate environment variables
   */
  loadEnv() {
    const required = ['OPENROUTER_API_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    this.envConfig = {
      port: parseInt(process.env.PORT) || 3000,
      nodeEnv: process.env.NODE_ENV || 'development',
      openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'
      },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        apiId: process.env.TELEGRAM_API_ID,
        apiHash: process.env.TELEGRAM_API_HASH
      },
      discord: {
        botToken: process.env.DISCORD_BOT_TOKEN
      },
      twitter: {
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_SECRET,
        bearerToken: process.env.TWITTER_BEARER_TOKEN
      },
      database: {
        path: process.env.DATABASE_PATH || './data/salt_index.db'
      },
      redis: {
        url: process.env.REDIS_URL || null
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info'
      },
      batch: {
        size: parseInt(process.env.BATCH_SIZE) || 30,
        timeout: parseInt(process.env.BATCH_TIMEOUT) || 60
      },
      debug: {
        traceRetentionDays: parseInt(process.env.DEBUG_TRACE_RETENTION_DAYS) || 30
      },
      apiKeys: {
        admin: process.env.ADMIN_API_KEY || null,
        view: process.env.VIEW_API_KEYS ? process.env.VIEW_API_KEYS.split(',') : []
      }
    };

    logger.info(`Environment: ${this.envConfig.nodeEnv}`);
    logger.info(`Port: ${this.envConfig.port}`);
  }

  /**
   * Load TOML configuration file
   */
  loadToml() {
    const configPath = path.join('config', 'config.toml');

    if (!fs.existsSync(configPath)) {
      logger.warn('config.toml not found. Will generate on first run.');
      this.tomlConfig = { sources: [], trackers: [] };
      return;
    }

    try {
      const tomlContent = fs.readFileSync(configPath, 'utf8');
      this.tomlConfig = toml.parse(tomlContent);
      logger.info('TOML configuration loaded successfully');
    } catch (error) {
      logger.error(`Failed to parse config.toml: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get merged configuration
   */
  getConfig() {
    return {
      env: this.envConfig,
      toml: this.tomlConfig
    };
  }

  /**
   * Validate configuration
   */
  validate() {
    // Validate trackers
    if (this.tomlConfig && this.tomlConfig.trackers) {
      const trackerIds = new Set();
      for (const tracker of this.tomlConfig.trackers) {
        if (trackerIds.has(tracker.id)) {
          throw new Error(`Duplicate tracker ID: ${tracker.id}`);
        }
        trackerIds.add(tracker.id);

        // Validate weights
        if (tracker.sources) {
          for (const source of tracker.sources) {
            if (source.weight < 0 || source.weight > 1) {
              throw new Error(`Invalid weight for source ${source.id}: ${source.weight}`);
            }
          }
        }
      }
    }

    logger.info('Configuration validation passed');
  }
}

module.exports = new ConfigLoader();
