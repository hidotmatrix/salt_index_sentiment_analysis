/**
 * Telegram Bot Manager
 * Singleton manager for shared Telegram bot instances.
 * Handles message routing to multiple registered sources based on chat/topic.
 */
const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');

class TelegramBotManager {
	constructor() {
		/** @type {TelegramBot|null} */
		this.bot = null;

		/** @type {string|null} */
		this.botToken = null;

		/** @type {boolean} */
		this.isPolling = false;

		/**
		 * Registered sources mapped by sourceId.
		 * @type {Map<string, {chatIdentifier: string, topicId: number|null, callback: Function}>}
		 */
		this.registrations = new Map();
	}

	/**
	 * Get the singleton instance of TelegramBotManager.
	 * @returns {TelegramBotManager}
	 */
	static getInstance() {
		if (!TelegramBotManager.instance) {
			TelegramBotManager.instance = new TelegramBotManager();
		}
		return TelegramBotManager.instance;
	}

	/**
	 * Initialize the bot with the given token.
	 * Creates the bot instance and sets up event listeners.
	 * @param {string} botToken - The Telegram bot API token.
	 * @throws {Error} If bot token is not provided or initialization fails.
	 */
	initialize(botToken) {
		if (!botToken) {
			throw new Error('Telegram bot token is required');
		}

		// If already initialized with same token, skip.
		if (this.bot && this.botToken === botToken && this.isPolling) {
			logger.debug('TelegramBotManager already initialized with this token');
			return;
		}

		// If initialized with different token, shutdown first.
		if (this.bot && this.botToken !== botToken) {
			logger.warn('TelegramBotManager reinitializing with different token');
			this.shutdown();
		}

		this.botToken = botToken;

		// Create bot instance with polling enabled.
		this.bot = new TelegramBot(botToken, {
			polling: true,
			request: {
				agentOptions: {
					keepAlive: true,
					keepAliveMsecs: 10000,
					family: 4  // Force IPv4
				},
				timeout: 15000
			}
		});

		this.isPolling = true;

		// Set up event listeners.
		this.setupEventListeners();

		logger.info('TelegramBotManager initialized and polling started');
	}

	/**
	 * Set up event listeners for incoming messages.
	 * @private
	 */
	setupEventListeners() {
		// Handle messages from groups/supergroups.
		this.bot.on('message', (msg) => {
			if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
				this.routeMessage(msg);
			}
		});

		// Handle channel posts.
		this.bot.on('channel_post', (msg) => {
			this.routeMessage(msg);
		});

		// Handle polling errors.
		this.bot.on('polling_error', (error) => {
			const errorMsg = this.extractNetworkError(error);
			logger.error(`TelegramBotManager polling error: ${errorMsg}`);
		});
	}

	/**
	 * Route an incoming message to all matching registered sources.
	 * @private
	 * @param {Object} msg - The Telegram message object.
	 */
	routeMessage(msg) {
		// Get the topic ID from the message (default to 1 for General topic).
		const messageTopicId = msg.message_thread_id || 1;
		const chatId = msg.chat.id;
		const chatUsername = msg.chat.username ? `@${msg.chat.username}` : null;

		// Route to all matching registrations.
		for (const [sourceId, registration] of this.registrations) {
			const { chatIdentifier, topicId, callback } = registration;

			// Check if chat matches (by ID or username).
			const chatMatches = this.chatMatches(chatIdentifier, chatId, chatUsername);
			if (!chatMatches) {
				continue;
			}

			// Check if topic matches (null means all messages).
			const topicMatches = topicId === null || topicId === messageTopicId;
			if (!topicMatches) {
				continue;
			}

			// Call the registered callback.
			try {
				callback(msg);
			} catch (error) {
				logger.error(`Error in callback for source ${sourceId}: ${error.message}`);
			}
		}
	}

	/**
	 * Check if a chat identifier matches the message's chat.
	 * @private
	 * @param {string} chatIdentifier - The registered chat identifier (e.g., "@NervosNation" or numeric ID).
	 * @param {number} chatId - The numeric chat ID from the message.
	 * @param {string|null} chatUsername - The chat username from the message (with @ prefix).
	 * @returns {boolean}
	 */
	chatMatches(chatIdentifier, chatId, chatUsername) {
		// If identifier starts with @, match by username.
		if (chatIdentifier.startsWith('@')) {
			return chatUsername === chatIdentifier;
		}

		// Otherwise, try to match by numeric ID.
		return chatIdentifier === chatId.toString();
	}

	/**
	 * Register a source to receive messages.
	 * @param {string} sourceId - Unique identifier for the source.
	 * @param {string} chatIdentifier - Chat identifier (e.g., "@NervosNation" or numeric ID).
	 * @param {number|null} topicId - Topic ID to filter by (1 for General, specific ID, or null for all).
	 * @param {Function} callback - Function to call with matching messages.
	 * @throws {Error} If bot is not initialized.
	 */
	registerSource(sourceId, chatIdentifier, topicId, callback) {
		if (!this.bot) {
			throw new Error('TelegramBotManager not initialized. Call initialize() first.');
		}

		if (typeof callback !== 'function') {
			throw new Error('Callback must be a function');
		}

		this.registrations.set(sourceId, {
			chatIdentifier,
			topicId,
			callback
		});

		logger.info(`Registered Telegram source: ${sourceId} for chat ${chatIdentifier}, topic ${topicId === null ? 'all' : topicId}`);
	}

	/**
	 * Unregister a source from receiving messages.
	 * @param {string} sourceId - The source ID to unregister.
	 * @returns {boolean} True if the source was registered and removed.
	 */
	unregisterSource(sourceId) {
		const removed = this.registrations.delete(sourceId);

		if (removed) {
			logger.info(`Unregistered Telegram source: ${sourceId}`);
		} else {
			logger.debug(`Source ${sourceId} was not registered`);
		}

		return removed;
	}

	/**
	 * Shutdown the bot manager.
	 * Stops polling and clears all registrations.
	 */
	async shutdown() {
		logger.info('TelegramBotManager shutting down...');

		// Stop polling if active.
		if (this.bot && this.isPolling) {
			try {
				await this.bot.stopPolling();
				logger.debug('Telegram polling stopped');
			} catch (error) {
				logger.error(`Error stopping polling: ${error.message}`);
			}
		}

		// Clear registrations.
		this.registrations.clear();

		// Reset state.
		this.bot = null;
		this.botToken = null;
		this.isPolling = false;

		logger.info('TelegramBotManager shutdown complete');
	}

	/**
	 * Extract user-friendly error message from network errors.
	 * @private
	 * @param {Error} error - The error to extract from.
	 * @returns {string} A user-friendly error message.
	 */
	extractNetworkError(error) {
		// Check if it's an AggregateError with nested errors.
		if (error.message && error.message.includes('EFATAL') && error.cause) {
			const cause = error.cause;

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

			return cause.message || error.message;
		}

		// Check error message directly for network codes.
		const msg = error.message || '';
		if (msg.includes('ETIMEDOUT')) return 'Network timeout - Unable to reach Telegram servers';
		if (msg.includes('ENETUNREACH')) return 'Network unreachable - Check internet connection';
		if (msg.includes('ECONNREFUSED')) return 'Connection refused - Telegram API may be blocked';
		if (msg.includes('ENOTFOUND')) return 'DNS resolution failed - Check network settings';

		return error.message || 'Unknown error';
	}

	/**
	 * Get the number of registered sources.
	 * @returns {number}
	 */
	getRegistrationCount() {
		return this.registrations.size;
	}

	/**
	 * Check if a source is registered.
	 * @param {string} sourceId - The source ID to check.
	 * @returns {boolean}
	 */
	isSourceRegistered(sourceId) {
		return this.registrations.has(sourceId);
	}
}

/** @type {TelegramBotManager|null} */
TelegramBotManager.instance = null;

module.exports = TelegramBotManager;
