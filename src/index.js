/**
 * Salt Index - Main Entry Point
 * 24/7 Sentiment and Signal Aggregation Backend
 */
const logger = require('./utils/logger');
const configLoader = require('./config/loader');
const configGenerator = require('./config/generator');
const database = require('./db');
const expressApp = require('./api/app');
const ConnectorManager = require('./connectors/ConnectorManager');
const BatchProcessor = require('./llm/BatchProcessor');

class SaltIndex {
  constructor() {
    this.config = null;
    this.server = null;
    this.connectorManager = null;
    this.batchProcessor = null;
    this.processingInterval = null;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      logger.info('=' .repeat(60));
      logger.info('SALT INDEX - Starting up...');
      logger.info('=' .repeat(60));

      // Step 1: Generate config if first launch
      await this.checkFirstLaunch();

      // Step 2: Load configuration
      this.config = configLoader.load();

      // Step 3: Validate configuration
      configLoader.validate();

      // Step 4: Initialize database
      await database.initialize(this.config.env.database.path);

      // Step 4.5: Initialize database from config (populate trackers & sources)
      const initializeFromConfig = require('./utils/initializeFromConfig');
      await initializeFromConfig();

      // Step 5: Start API server
      const port = this.config.env.port;
      this.server = await expressApp.start(port);

      // Step 6: Initialize connectors (if sources are configured)
      if (this.config.toml && this.config.toml.sources && this.config.toml.sources.length > 0) {
        this.connectorManager = new ConnectorManager(this.config);
        await this.connectorManager.initialize();

        // Step 7: Start batch processor
        this.batchProcessor = new BatchProcessor(this.config);
        this.batchProcessor.start();

        // Step 8: Start message collection loop
        this.startMessageCollection();
      } else {
        logger.warn('No sources configured. Add sources in config.toml to start monitoring.');
      }

      logger.info('=' .repeat(60));
      logger.info('✅ Salt Index is running!');
      logger.info('=' .repeat(60));

      // Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error(`Failed to initialize Salt Index: ${error.message}`);
      logger.error(error.stack);
      process.exit(1);
    }
  }

  /**
   * Check if this is first launch
   */
  async checkFirstLaunch() {
    const fs = require('fs');
    const path = require('path');

    const configPath = path.join('config', 'config.toml');
    const hasAdminKey = process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.trim() !== '';

    if (!fs.existsSync(configPath) || !hasAdminKey) {
      await configGenerator.generateAll();

      // Reload environment variables after generation
      require('dotenv').config();
    }
  }

  /**
   * Start message collection loop
   */
  startMessageCollection() {
    logger.info('Starting message collection loop...');

    // Collect messages every 5 seconds
    this.processingInterval = setInterval(async () => {
      try {
        if (this.connectorManager && this.batchProcessor) {
          const messages = await this.connectorManager.getAllMessages();

          if (messages.length > 0) {
            logger.debug(`Collected ${messages.length} messages from connectors`);
            this.batchProcessor.queueMessages(messages);
          }
        }
      } catch (error) {
        logger.error(`Error in message collection loop: ${error.message}`);
      }
    }, 5000);

    logger.info('Message collection loop started');
  }

  /**
   * Setup graceful shutdown
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      // Stop message collection
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
      }

      // Stop batch processor
      if (this.batchProcessor) {
        this.batchProcessor.stop();
      }

      // Disconnect connectors
      if (this.connectorManager) {
        await this.connectorManager.disconnectAll();
      }

      // Close server
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Close database
      database.close();

      // Exit
      setTimeout(() => process.exit(0), 1000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Start the application
   */
  async start() {
    await this.initialize();
  }
}

// Start application
const saltIndex = new SaltIndex();
saltIndex.start();

module.exports = saltIndex;
