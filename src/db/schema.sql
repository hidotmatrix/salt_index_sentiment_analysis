-- ============================================================
-- SALT INDEX - Database Schema
-- ============================================================
-- SQLite database schema for Salt Index
-- See docs/DATABASE_SCHEMA.md for detailed documentation
-- ============================================================

-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Trackers table
CREATE TABLE IF NOT EXISTS trackers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    enabled_tags TEXT NOT NULL, -- JSON array
    excluded_from_sentiment TEXT NOT NULL, -- JSON array
    time_buckets TEXT NOT NULL, -- JSON array
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sources table
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('telegram', 'discord', 'twitter')),
    target TEXT NOT NULL,
    config TEXT NOT NULL, -- JSON object
    weight REAL NOT NULL DEFAULT 1.0 CHECK(weight >= 0 AND weight <= 1.0),
    paused BOOLEAN NOT NULL DEFAULT 0,
    health_status TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('healthy', 'degraded', 'failed', 'unknown')),
    last_message_at DATETIME,
    last_error TEXT,
    last_error_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE
);

-- Users table (platform-scoped)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    username TEXT,
    display_name TEXT,
    first_seen_at DATETIME NOT NULL,
    last_active_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform, platform_user_id)
);

-- ============================================================
-- AGGREGATION TABLES
-- ============================================================

-- Source-level aggregates
CREATE TABLE IF NOT EXISTS source_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    tracker_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    bucket_start DATETIME NOT NULL,
    bucket_end DATETIME NOT NULL,
    sentiment_score REAL NOT NULL,
    message_count INTEGER NOT NULL,
    author_count INTEGER NOT NULL,
    tag_counts TEXT NOT NULL, -- JSON object
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE,
    UNIQUE(source_id, bucket, bucket_start)
);

-- Tracker-level aggregates
CREATE TABLE IF NOT EXISTS tracker_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    bucket_start DATETIME NOT NULL,
    bucket_end DATETIME NOT NULL,
    sentiment_score REAL NOT NULL,
    message_count INTEGER NOT NULL,
    author_count INTEGER NOT NULL,
    tag_counts TEXT NOT NULL, -- JSON object
    source_contributions TEXT NOT NULL, -- JSON array
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE,
    UNIQUE(tracker_id, bucket, bucket_start)
);

-- User-level aggregates
CREATE TABLE IF NOT EXISTS user_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tracker_id TEXT NOT NULL,
    total_messages INTEGER NOT NULL DEFAULT 0,
    avg_sentiment REAL NOT NULL DEFAULT 0.0,
    sentiment_stddev REAL NOT NULL DEFAULT 0.0,
    tag_counts TEXT NOT NULL DEFAULT '{}',
    first_message_at DATETIME NOT NULL,
    last_message_at DATETIME NOT NULL,
    active_days INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE,
    UNIQUE(user_id, tracker_id)
);

-- ============================================================
-- OPERATIONAL TABLES
-- ============================================================

-- Cursors for resumption
CREATE TABLE IF NOT EXISTS cursors (
    source_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    cursor_value TEXT NOT NULL,
    last_message_id TEXT,
    last_message_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Debug traces (30-day rolling)
CREATE TABLE IF NOT EXISTS debug_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL CHECK(level IN ('ERROR', 'WARN', 'INFO', 'DEBUG')),
    component TEXT NOT NULL,
    source_id TEXT,
    tracker_id TEXT,
    message TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE SET NULL
);

-- LLM batch log
CREATE TABLE IF NOT EXISTS llm_batch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id TEXT NOT NULL,
    batch_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER NOT NULL,
    source_ids TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    sentiment_score REAL,
    author_count INTEGER,
    tag_counts TEXT,
    processing_time_ms INTEGER,
    tokens_used INTEGER,
    cost_usd REAL,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE
);

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Source lookups
CREATE INDEX IF NOT EXISTS idx_sources_tracker ON sources(tracker_id);
CREATE INDEX IF NOT EXISTS idx_sources_platform ON sources(platform);
CREATE INDEX IF NOT EXISTS idx_sources_health ON sources(health_status);

-- User lookups
CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at DESC);

-- Source aggregates
CREATE INDEX IF NOT EXISTS idx_source_agg_source_bucket ON source_aggregates(source_id, bucket, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_source_agg_tracker_bucket ON source_aggregates(tracker_id, bucket, bucket_start DESC);

-- Tracker aggregates
CREATE INDEX IF NOT EXISTS idx_tracker_agg_tracker_bucket ON tracker_aggregates(tracker_id, bucket, bucket_start DESC);

-- User aggregates
CREATE INDEX IF NOT EXISTS idx_user_agg_tracker ON user_aggregates(tracker_id);
CREATE INDEX IF NOT EXISTS idx_user_agg_messages ON user_aggregates(total_messages DESC);
CREATE INDEX IF NOT EXISTS idx_user_agg_sentiment ON user_aggregates(avg_sentiment DESC);

-- Debug traces
CREATE INDEX IF NOT EXISTS idx_debug_traces_timestamp ON debug_traces(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_debug_traces_level ON debug_traces(level);

-- LLM batch log
CREATE INDEX IF NOT EXISTS idx_llm_batch_tracker ON llm_batch_log(tracker_id);
CREATE INDEX IF NOT EXISTS idx_llm_batch_timestamp ON llm_batch_log(batch_timestamp DESC);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-cleanup debug traces (30 days)
CREATE TRIGGER IF NOT EXISTS cleanup_debug_traces
AFTER INSERT ON debug_traces
BEGIN
    DELETE FROM debug_traces
    WHERE timestamp < datetime('now', '-30 days');
END;

-- Update tracker updated_at on modification
CREATE TRIGGER IF NOT EXISTS update_tracker_timestamp
AFTER UPDATE ON trackers
BEGIN
    UPDATE trackers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Update source updated_at on modification
CREATE TRIGGER IF NOT EXISTS update_source_timestamp
AFTER UPDATE ON sources
BEGIN
    UPDATE sources SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ============================================================
-- INITIAL MIGRATION RECORD
-- ============================================================

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES (1, 'Initial schema');
