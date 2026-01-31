/**
 * Discord Connector
 * Monitors Discord servers/channels for messages
 */
const { Client, GatewayIntentBits } = require('discord.js');
const BaseConnector = require('./BaseConnector');
const logger = require('../utils/logger');

class DiscordConnector extends BaseConnector {
  constructor(source, config) {
    super(source, config);
    this.client = null;
    this.connected = false;
    this.seenMessages = new Set();
    this.targetChannel = null;
  }

  /**
   * Connect to Discord
   */
  async connect() {
    try {
      logger.info(`Connecting Discord source: ${this.source.id} (${this.source.target})`);

      const botToken = this.config.discord.botToken;
      if (!botToken) {
        throw new Error('Discord bot token not configured');
      }

      // Create client with necessary intents
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent
        ]
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Login
      await this.client.login(botToken);

      this.updateHealth('healthy');
      logger.info(`Discord source connected: ${this.source.id}`);

    } catch (error) {
      logger.error(`Failed to connect Discord source ${this.source.id}: ${error.message}`);
      this.updateHealth('failed', error.message);
      throw error;
    }
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Ready event
    this.client.once('ready', () => {
      logger.info(`Discord bot logged in as ${this.client.user.tag}`);
      this.connected = true;

      // Get target channel
      const channelId = this.source.config.channel_id;
      this.targetChannel = this.client.channels.cache.get(channelId);

      if (!this.targetChannel) {
        logger.warn(`Discord channel ${channelId} not found for source ${this.source.id}`);
        this.updateHealth('degraded', 'Channel not found or bot not in server');
      } else {
        logger.info(`Monitoring Discord channel: #${this.targetChannel.name}`);
      }
    });

    // Message event
    this.client.on('messageCreate', (message) => this.handleMessage(message));

    // Error event
    this.client.on('error', (error) => {
      logger.error(`Discord error for ${this.source.id}: ${error.message}`);
      this.updateHealth('degraded', error.message);
    });

    // Disconnect event
    this.client.on('disconnect', () => {
      logger.warn(`Discord disconnected for ${this.source.id}`);
      this.connected = false;
    });
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message) {
    try {
      // Skip if not from target channel
      if (message.channel.id !== this.source.config.channel_id) {
        return;
      }

      // Skip bot messages
      if (message.author.bot) {
        return;
      }

      // Skip if no content
      if (!message.content) {
        return;
      }

      // Check deduplication
      const messageId = message.id;
      if (this.isDuplicate(messageId, this.seenMessages)) {
        return;
      }
      this.seenMessages.add(messageId);

      // Normalize message
      const normalizedMsg = this.normalizeMessage({
        id: messageId,
        text: message.content,
        author: {
          id: message.author.id,
          username: message.author.username,
          displayName: message.author.displayName || message.author.username
        },
        timestamp: message.createdAt.toISOString(),
        metadata: {
          channelId: message.channel.id,
          channelName: message.channel.name,
          serverId: message.guild ? message.guild.id : null,
          serverName: message.guild ? message.guild.name : null
        }
      });

      // Add to queue for LLM processing
      this.messageQueue.push(normalizedMsg);

      // Update cursor (using snowflake ID)
      await this.updateCursor(messageId, messageId);

      // Update source last_message_at
      const db = require('../db');
      await db.run(
        'UPDATE sources SET last_message_at = ? WHERE id = ?',
        [normalizedMsg.timestamp, this.source.id]
      );

      logger.debug(`Discord message queued: ${this.source.id} - "${message.content.substring(0, 50)}..."`);

    } catch (error) {
      logger.error(`Error handling Discord message: ${error.message}`);
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
   * Disconnect from Discord
   */
  async disconnect() {
    try {
      if (this.client) {
        await this.client.destroy();
        this.connected = false;
      }
      logger.info(`Discord source disconnected: ${this.source.id}`);
    } catch (error) {
      logger.error(`Error disconnecting Discord: ${error.message}`);
    }
  }
}

module.exports = DiscordConnector;
