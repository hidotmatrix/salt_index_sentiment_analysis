/**
 * Connector Manager
 * Manages all platform connectors
 */
const TelegramConnector = require('./TelegramConnector');
const DiscordConnector = require('./DiscordConnector');
const TwitterConnector = require('./TwitterConnector');
const TelegramBotManager = require('./TelegramBotManager');
const logger = require('../utils/logger');

class ConnectorManager {
  constructor(config) {
    this.config = config;
    this.connectors = new Map();
    this.running = false;
  }

  /**
   * Initialize all connectors from configuration
   */
  async initialize() {
    try {
      logger.info('Initializing connectors...');

      // Get sources from config
      const sources = this.config.toml?.sources || [];

      if (sources.length === 0) {
        logger.warn('No sources configured. Add sources in config.toml');
        return;
      }

      // Create connector for each source
      for (const source of sources) {
        if (source.paused) {
          logger.info(`Skipping paused source: ${source.id}`);
          continue;
        }

        await this.createConnector(source);
      }

      logger.info(`Initialized ${this.connectors.size} connectors`);

    } catch (error) {
      logger.error(`Failed to initialize connectors: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create connector for a source
   */
  async createConnector(source) {
    try {
      let connector;

      switch (source.platform) {
        case 'telegram':
          connector = new TelegramConnector(source, this.config.env);
          break;

        case 'discord':
          connector = new DiscordConnector(source, this.config.env);
          break;

        case 'twitter':
          connector = new TwitterConnector(source, this.config.env);
          break;

        default:
          logger.warn(`Unknown platform: ${source.platform} for source: ${source.id}`);
          return;
      }

      // Connect
      await connector.connect();

      // Store connector
      this.connectors.set(source.id, connector);

      logger.info(`Connector created: ${source.id} (${source.platform})`);

    } catch (error) {
      logger.error(`Failed to create connector for ${source.id}: ${error.message}`);
    }
  }

  /**
   * Get all messages from all connectors
   */
  async getAllMessages() {
    const allMessages = [];

    for (const [sourceId, connector] of this.connectors) {
      try {
        const messages = await connector.getMessages();
        allMessages.push(...messages);
      } catch (error) {
        logger.error(`Error getting messages from ${sourceId}: ${error.message}`);
      }
    }

    return allMessages;
  }

  /**
   * Get connector by source ID
   */
  getConnector(sourceId) {
    return this.connectors.get(sourceId);
  }

  /**
   * Disconnect all connectors
   */
  async disconnectAll() {
    logger.info('Disconnecting all connectors...');

    for (const [sourceId, connector] of this.connectors) {
      try {
        await connector.disconnect();
      } catch (error) {
        logger.error(`Error disconnecting ${sourceId}: ${error.message}`);
      }
    }

    // Shutdown shared Telegram bot manager
    await TelegramBotManager.getInstance().shutdown();

    this.connectors.clear();
    logger.info('All connectors disconnected');
  }
}

module.exports = ConnectorManager;
