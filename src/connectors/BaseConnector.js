/**
 * Base Connector Class
 * Abstract class for platform connectors
 */
const logger = require('../utils/logger');

class BaseConnector {
  constructor(source, config) {
    this.source = source;
    this.config = config;
    this.health = 'unknown';
    this.lastError = null;
    this.messageQueue = [];
  }

  /**
   * Connect to platform
   * Must be implemented by child classes
   */
  async connect() {
    throw new Error('connect() must be implemented by child class');
  }

  /**
   * Disconnect from platform
   * Must be implemented by child classes
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by child class');
  }

  /**
   * Get messages from platform
   * Must be implemented by child classes
   */
  async getMessages() {
    throw new Error('getMessages() must be implemented by child class');
  }

  /**
   * Update health status
   */
  updateHealth(status, error = null) {
    this.health = status;
    this.lastError = error;

    const db = require('../db');
    db.run(
      'UPDATE sources SET health_status = ?, last_error = ?, last_error_at = ? WHERE id = ?',
      [status, error, error ? new Date().toISOString() : null, this.source.id]
    ).catch(err => logger.error(`Failed to update source health: ${err.message}`));
  }

  /**
   * Update cursor (for resumption)
   */
  async updateCursor(cursorValue, messageId = null) {
    const db = require('../db');

    try {
      await db.run(
        `INSERT INTO cursors (source_id, platform, cursor_value, last_message_id, last_message_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           cursor_value = excluded.cursor_value,
           last_message_id = excluded.last_message_id,
           last_message_at = excluded.last_message_at,
           updated_at = excluded.updated_at`,
        [
          this.source.id,
          this.source.platform,
          cursorValue.toString(),
          messageId,
          new Date().toISOString(),
          new Date().toISOString()
        ]
      );
    } catch (error) {
      logger.error(`Failed to update cursor for ${this.source.id}: ${error.message}`);
    }
  }

  /**
   * Get current cursor
   */
  async getCursor() {
    const db = require('../db');

    try {
      const cursor = await db.queryOne(
        'SELECT * FROM cursors WHERE source_id = ?',
        [this.source.id]
      );
      return cursor ? cursor.cursor_value : null;
    } catch (error) {
      logger.error(`Failed to get cursor for ${this.source.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Normalize message format
   */
  normalizeMessage(rawMessage) {
    return {
      id: rawMessage.id,
      platform: this.source.platform,
      sourceId: this.source.id,
      trackerId: this.source.tracker_id,
      text: rawMessage.text,
      author: {
        id: rawMessage.author.id,
        username: rawMessage.author.username,
        displayName: rawMessage.author.displayName
      },
      timestamp: rawMessage.timestamp,
      metadata: rawMessage.metadata || {}
    };
  }

  /**
   * Deduplicate message
   */
  isDuplicate(messageId, seenMessages) {
    return seenMessages.has(messageId);
  }
}

module.exports = BaseConnector;
