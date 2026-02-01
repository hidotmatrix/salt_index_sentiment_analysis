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
const CleanupManager = require('./utils/CleanupManager');

class SaltIndex {
  constructor() {
    this.config = null;
    this.server = null;
    this.connectorManager = null;
    this.batchProcessor = null;
    this.cleanupManager = null;
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

      // Step 5: Initialize Express app with configuration (including auth)
      expressApp.init(this.config);

      // Step 6: Start API server
      const port = this.config.env.port;
      this.server = await expressApp.start(port);

      // Step 7: Initialize connectors (if sources are configured)
      const hasActiveSources = this.config.toml &&
                               this.config.toml.sources &&
                               this.config.toml.sources.filter(s => !s.paused).length > 0;

      if (hasActiveSources) {
        this.connectorManager = new ConnectorManager(this.config);
        await this.connectorManager.initialize();

        // Step 8: Start batch processor
        this.batchProcessor = new BatchProcessor(this.config);
        this.batchProcessor.start();

        // Step 9: Start message collection loop
        this.startMessageCollection();
      } else {
        logger.warn('');
        logger.warn('⚠️  ' + '='.repeat(58));
        logger.warn('⚠️  WARNING: NO ACTIVE SOURCES CONFIGURED');
        logger.warn('⚠️  ' + '='.repeat(58));
        logger.warn('⚠️  Salt Index is running but NOT monitoring any sources.');
        logger.warn('⚠️  The API is available but no data will be collected.');
        logger.warn('⚠️  ');
        logger.warn('⚠️  To start monitoring:');
        logger.warn('⚠️  1. Edit config/config.toml');
        logger.warn('⚠️  2. Uncomment and configure a [[sources]] section');
        logger.warn('⚠️  3. Restart the service or call POST /api/admin/reload-config');
        logger.warn('⚠️  ' + '='.repeat(58));
        logger.warn('');
      }

      // Step 10: Start cleanup manager
      this.cleanupManager = new CleanupManager(this.config);
      this.cleanupManager.start();

      logger.info('=' .repeat(60));
      logger.info('✅ Salt Index is running!');
      logger.info('=' .repeat(60));

      // Repeat warning after startup banner if no sources
      if (!hasActiveSources) {
        logger.warn('');
        logger.warn('⚠️  REMINDER: Configure sources in config.toml to start monitoring');
        logger.warn('');
      }

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Make processor available to API routes via app context
      if (this.batchProcessor) {
        expressApp.setBatchProcessor(this.batchProcessor);
      }

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
    let shutdownInProgress = false;

    const shutdown = async (signal) => {
      if (shutdownInProgress) {
        logger.warn('Shutdown already in progress...');
        return;
      }

      shutdownInProgress = true;
      logger.info(`${signal} received. Shutting down gracefully...`);

      // Set a timeout to force exit if graceful shutdown takes too long
      const forceExitTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing exit...');
        process.exit(1);
      }, 30000); // 30 second timeout

      try {
        // Step 1: Stop accepting new messages
        logger.info('Stopping message collection...');
        if (this.processingInterval) {
          clearInterval(this.processingInterval);
        }

        // Step 2: Close HTTP server (stop accepting new requests)
        logger.info('Closing HTTP server...');
        if (this.server) {
          await new Promise((resolve) => {
            this.server.close(() => {
              logger.info('HTTP server closed');
              resolve();
            });
          });
        }

        // Step 3: Process any remaining messages in queue
        if (this.batchProcessor) {
          const queueStats = this.batchProcessor.getQueueStats();
          if (queueStats.total_queued > 0) {
            logger.info(`Processing ${queueStats.total_queued} remaining messages in queue...`);
            await this.batchProcessor.processBatches();
          }

          // Stop batch processor
          logger.info('Stopping batch processor...');
          this.batchProcessor.stop();
        }

        // Step 4: Stop cleanup manager
        logger.info('Stopping cleanup manager...');
        if (this.cleanupManager) {
          this.cleanupManager.stop();
        }

        // Step 5: Disconnect connectors
        logger.info('Disconnecting connectors...');
        if (this.connectorManager) {
          await this.connectorManager.disconnectAll();
        }

        // Step 6: Close database
        logger.info('Closing database...');
        database.close();

        clearTimeout(forceExitTimeout);
        logger.info('✅ Graceful shutdown complete');
        process.exit(0);

      } catch (error) {
        logger.error(`Error during shutdown: ${error.message}`);
        clearTimeout(forceExitTimeout);
        process.exit(1);
      }
    };

    // Handle signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught Exception: ${error.message}`);
      logger.error(error.stack);
      shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
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
