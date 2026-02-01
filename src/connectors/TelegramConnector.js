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

      // Create bot instance with request options
      this.bot = new TelegramBot(botToken, {
        polling: false,
        request: {
          agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 10000,
            family: 4  // Force IPv4
          },
          timeout: 15000
        }
      });

      logger.info(`Telegram bot initialized for ${this.source.id}`);

      // Start monitoring (skip connection test due to network issues)
      await this.startMonitoring();

      this.updateHealth('healthy');
      logger.info(`Telegram source connected: ${this.source.id}`);

    } catch (error) {
      const errorMsg = this.extractNetworkError(error);
      logger.error(`Failed to connect Telegram source ${this.source.id}: ${errorMsg}`);
      this.updateHealth('failed', errorMsg);
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
        const errorMsg = this.extractNetworkError(error);
        logger.error(`Telegram polling error for ${this.source.id}: ${errorMsg}`);
        this.updateHealth('degraded', errorMsg);
      });

      logger.info(`Telegram monitoring started for ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to start Telegram monitoring: ${error.message}`);
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

      // Extract author info (channel posts use sender_chat, group messages use from)
      let authorId, username, displayName;

      if (msg.from) {
        // Group/supergroup message with user info
        authorId = msg.from.id.toString();
        username = msg.from.username || msg.from.first_name || `user_${authorId}`;
        displayName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || username;
      } else if (msg.sender_chat) {
        // Channel post (sender_chat is the channel itself)
        authorId = msg.sender_chat.id.toString();
        username = msg.sender_chat.username || msg.sender_chat.title || `channel_${authorId}`;
        displayName = msg.sender_chat.title || username;
      } else {
        // Fallback (shouldn't happen but be safe)
        authorId = 'unknown';
        username = 'unknown';
        displayName = 'Unknown';
      }

      // Normalize message
      const normalizedMsg = this.normalizeMessage({
        id: messageId,
        text: msg.text,
        author: {
          id: authorId,
          username: username,
          displayName: displayName
        },
        timestamp: new Date(msg.date * 1000).toISOString(),
        metadata: {
          chatId: msg.chat.id,
          chatTitle: msg.chat.title,
          messageId: msg.message_id,
          forwardFrom: msg.forward_from ? msg.forward_from.username : null,
          senderType: msg.from ? 'user' : 'channel'
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
   * Extract user-friendly error message from network errors
   */
  extractNetworkError(error) {
    // Check if it's an AggregateError with nested errors
    if (error.message && error.message.includes('EFATAL') && error.cause) {
      const cause = error.cause;

      // Extract specific network error codes
      if (cause.code === 'ETIMEDOUT' || cause.message?.includes('ETIMEDOUT')) {
        return 'Network timeout - Unable to reach Telegram servers';
      }
      if (cause.code === 'ENETUNREACH' || cause.message?.includes('ENETUNREACH')) {
        return 'Network unreachable - Check internet connection';
      }
      if (cause.code === 'ECONNREFUSED' || cause.message?.includes('ECONNREFUSED')) {
        return 'Connection refused - Telegram API may be blocked';
      }
      if (cause.code === 'ENOTFOUND' || cause.message?.includes('ENOTFOUND')) {
        return 'DNS resolution failed - Check network settings';
      }

      // Return the cause message if available
      return cause.message || error.message;
    }

    // Check error message directly for network codes
    const msg = error.message || '';
    if (msg.includes('ETIMEDOUT')) return 'Network timeout - Unable to reach Telegram servers';
    if (msg.includes('ENETUNREACH')) return 'Network unreachable - Check internet connection';
    if (msg.includes('ECONNREFUSED')) return 'Connection refused - Telegram API may be blocked';
    if (msg.includes('ENOTFOUND')) return 'DNS resolution failed - Check network settings';

    // Default to original message
    return error.message || 'Unknown error';
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
