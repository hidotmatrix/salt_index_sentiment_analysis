/**
 * Database Connection and Initialization
 */
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class DatabaseManager {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize database connection
   */
  async initialize(dbPath) {
    logger.info(`Initializing database at: ${dbPath}`);

    // Ensure data directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    // Connect to database
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, async (err) => {
        if (err) {
          logger.error(`Failed to connect to database: ${err.message}`);
          reject(err);
        } else {
          logger.info('Database connection established');

          // Enable WAL mode and foreign keys
          await this.exec('PRAGMA journal_mode = WAL');
          await this.exec('PRAGMA foreign_keys = ON');
          await this.exec('PRAGMA synchronous = NORMAL');

          // Run schema initialization
          await this.runSchema();

          logger.info('Database initialized successfully');
          resolve();
        }
      });
    });
  }

  /**
   * Run schema SQL file
   */
  async runSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema
    await this.exec(schema);

    logger.info('Database schema applied');
  }

  /**
   * Execute SQL (for schema/pragma)
   */
  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get database instance
   */
  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          logger.error(`Error closing database: ${err.message}`);
        } else {
          logger.info('Database connection closed');
        }
      });
    }
  }

  /**
   * Execute a query (returns all rows)
   */
  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Execute a single-row query
   */
  queryOne(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /**
   * Execute an insert/update/delete
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
}

// Export singleton instance
module.exports = new DatabaseManager();
