/**
 * Telegram Connector
 * Monitors Telegram channels/groups for messages
 */
const TelegramBotManager = require('./TelegramBotManager');
const BaseConnector = require('./BaseConnector');
const logger = require('../utils/logger');

class TelegramConnector extends BaseConnector {
	constructor(source, config) {
		super(source, config);
		this.botManager = TelegramBotManager.getInstance();
		this.seenMessages = new Set();

		// Parse target to extract chatIdentifier and topicId.
		// Format: "@GroupName/TopicId" or "@GroupName" (no topic = null).
		const { chatIdentifier, topicId } = this.parseTarget(source.target);
		this.chatIdentifier = chatIdentifier;
		this.topicId = topicId;
	}

	/**
	 * Parse the target string to extract chat identifier and topic ID.
	 * @param {string} target - The target string (e.g., "@NervosNation/295370" or "@NervosNation").
	 * @returns {{chatIdentifier: string, topicId: number|null}}
	 */
	parseTarget(target) {
		const slashIndex = target.indexOf('/');

		if (slashIndex === -1) {
			// No topic specified - null means all messages.
			return {
				chatIdentifier: target,
				topicId: null
			};
		}

		// Split into chat identifier and topic ID.
		const chatIdentifier = target.substring(0, slashIndex);
		const topicIdStr = target.substring(slashIndex + 1);
		const topicId = parseInt(topicIdStr, 10);

		if (isNaN(topicId)) {
			logger.warn(`Invalid topic ID in target "${target}", defaulting to null`);
			return {
				chatIdentifier: target,
				topicId: null
			};
		}

		return {
			chatIdentifier,
			topicId
		};
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

			// Initialize the shared bot manager (idempotent - safe to call multiple times).
			this.botManager.initialize(botToken);

			// Register this source with the bot manager.
			this.botManager.registerSource(
				this.source.id,
				this.chatIdentifier,
				this.topicId,
				(msg) => this.handleMessage(msg)
			);

			this.updateHealth('healthy');
			logger.info(`Telegram source connected: ${this.source.id}`);

		} catch (error) {
			logger.error(`Failed to connect Telegram source ${this.source.id}: ${error.message}`);
			this.updateHealth('failed', error.message);
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
					topicId: msg.message_thread_id || null,
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
	 * Disconnect from Telegram
	 */
	async disconnect() {
		try {
			this.botManager.unregisterSource(this.source.id);
			logger.info(`Telegram source disconnected: ${this.source.id}`);
		} catch (error) {
			logger.error(`Error disconnecting Telegram: ${error.message}`);
		}
	}
}

module.exports = TelegramConnector;
