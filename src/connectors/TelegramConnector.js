/**
 * Telegram Connector
 * Monitors Telegram channels/groups for messages
 */
const TelegramBot = require('node-telegram-bot-api');
const BaseConnector = require('./BaseConnector');
const logger = require('../utils/logger');

class TelegramConnector extends BaseConnector {
  constructor(source, config) {
    super(source, config);
    this.bot = null;
    this.polling = false;
    this.seenMessages = new Set();
  }

  /**
   * Connect to Telegram
   */
  async connect() {
    try {
      logger.info(`Connecting Telegram source: ${this.source.id} (${this.source.target})`);

      const botToken = this.config.telegram.botToken;
      if (!botToken) {
        throw new Error('Telegram bot token not configured');
      }

      // Create bot instance (no polling yet)
      this.bot = new TelegramBot(botToken, { polling: false });

      // Test connection
      const me = await this.bot.getMe();
      logger.info(`Telegram bot connected: @${me.username}`);

      // Start monitoring
      await this.startMonitoring();

      this.updateHealth('healthy');
      logger.info(`Telegram source connected: ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to connect Telegram source ${this.source.id}: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      if (error.errors) {
        logger.error(`Aggregated errors: ${JSON.stringify(error.errors, null, 2)}`);
      }
      this.updateHealth('failed', error.message);
      throw error;
    }
  }

  /**
   * Start monitoring channel/group
   */
  async startMonitoring() {
    try {
      // Stop any existing polling first
      try {
        if (this.bot.isPolling()) {
          await this.bot.stopPolling();
          logger.debug(`Stopped existing polling for ${this.source.id}`);
        }
      } catch (stopError) {
        logger.debug(`No existing polling to stop: ${stopError.message}`);
      }

      // Enable polling with error handling
      this.bot.startPolling({ restart: true });
      this.polling = true;

      // Listen for channel posts
      this.bot.on('channel_post', (msg) => this.handleMessage(msg));

      // Listen for group messages (if monitoring a group)
      this.bot.on('message', (msg) => {
        // Only process if from a group/supergroup (not private chat)
        if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
          this.handleMessage(msg);
        }
      });

      // Handle polling errors
      this.bot.on('polling_error', (error) => {
        logger.error(`Telegram polling error for ${this.source.id}: ${error.message}`);
        this.updateHealth('degraded', error.message);
      });

      logger.info(`Telegram monitoring started for ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to start Telegram monitoring: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      if (error.errors) {
        logger.error(`Aggregated errors: ${JSON.stringify(error.errors, null, 2)}`);
      }
      throw error;
    }
  }

  /**
   * Handle incoming message
   */
  async handleMessage(msg) {
    try {
      // Skip if no text
      if (!msg.text) return;

      // Check deduplication
      const messageId = `${msg.chat.id}:${msg.message_id}`;
      if (this.isDuplicate(messageId, this.seenMessages)) {
        return;
      }
      this.seenMessages.add(messageId);

      // Normalize message
      const normalizedMsg = this.normalizeMessage({
        id: messageId,
        text: msg.text,
        author: {
          id: msg.from ? msg.from.id.toString() : 'unknown',
          username: msg.from ? msg.from.username || msg.from.first_name : 'unknown',
          displayName: msg.from ? `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() : 'Unknown'
        },
        timestamp: new Date(msg.date * 1000).toISOString(),
        metadata: {
          chatId: msg.chat.id,
          chatTitle: msg.chat.title,
          messageId: msg.message_id,
          forwardFrom: msg.forward_from ? msg.forward_from.username : null
        }
      });

      // Add to queue for LLM processing
      this.messageQueue.push(normalizedMsg);

      // Update cursor
      await this.updateCursor(msg.message_id, messageId);

      // Update source last_message_at
      const db = require('../db');
      await db.run(
        'UPDATE sources SET last_message_at = ? WHERE id = ?',
        [normalizedMsg.timestamp, this.source.id]
      );

      logger.debug(`Telegram message queued: ${this.source.id} - "${msg.text.substring(0, 50)}..."`);

    } catch (error) {
      logger.error(`Error handling Telegram message: ${error.message}`);
    }
  }

  /**
   * Get queued messages
   */
  async getMessages() {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect() {
    try {
      if (this.bot && this.polling) {
        await this.bot.stopPolling();
        this.polling = false;
      }
      logger.info(`Telegram source disconnected: ${this.source.id}`);
    } catch (error) {
      logger.error(`Error disconnecting Telegram: ${error.message}`);
    }
  }
}

module.exports = TelegramConnector;
