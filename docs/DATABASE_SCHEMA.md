# Salt Index - Database Schema

SQLite database at `./data/salt_index.db` with WAL mode.

## Tables

### trackers
```sql
CREATE TABLE trackers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    enabled_tags TEXT NOT NULL,              -- JSON array
    excluded_from_sentiment TEXT NOT NULL,   -- JSON array
    time_buckets TEXT NOT NULL,              -- JSON array
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### sources
```sql
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('telegram', 'discord', 'twitter')),
    target TEXT NOT NULL,
    config TEXT NOT NULL,                    -- JSON
    weight REAL NOT NULL DEFAULT 1.0 CHECK(weight >= 0 AND weight <= 1.0),
    paused BOOLEAN NOT NULL DEFAULT 0,
    health_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK(health_status IN ('healthy', 'degraded', 'failed', 'unknown')),
    last_message_at DATETIME,
    last_error TEXT,
    last_error_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE
);
```

### users
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,                     -- Format: 'platform:user_id'
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
```

### source_aggregates
```sql
CREATE TABLE source_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    tracker_id TEXT NOT NULL,
    bucket TEXT NOT NULL,                    -- '1min', '5min', '1hour', '1day', '7day'
    bucket_start DATETIME NOT NULL,
    bucket_end DATETIME NOT NULL,
    sentiment_score REAL NOT NULL,
    message_count INTEGER NOT NULL,
    author_count INTEGER NOT NULL,
    tag_counts TEXT NOT NULL,                -- JSON
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    UNIQUE(source_id, bucket, bucket_start)
);
```

### tracker_aggregates
```sql
CREATE TABLE tracker_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    bucket_start DATETIME NOT NULL,
    bucket_end DATETIME NOT NULL,
    sentiment_score REAL NOT NULL,           -- Weighted average
    message_count INTEGER NOT NULL,
    author_count INTEGER NOT NULL,
    tag_counts TEXT NOT NULL,                -- JSON
    source_contributions TEXT NOT NULL,      -- JSON array
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE,
    UNIQUE(tracker_id, bucket, bucket_start)
);
```

### user_aggregates
```sql
CREATE TABLE user_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tracker_id TEXT NOT NULL,
    total_messages INTEGER NOT NULL DEFAULT 0,
    avg_sentiment REAL NOT NULL DEFAULT 0.0,
    sentiment_stddev REAL NOT NULL DEFAULT 0.0,
    tag_counts TEXT NOT NULL DEFAULT '{}',   -- JSON
    first_message_at DATETIME NOT NULL,
    last_message_at DATETIME NOT NULL,
    active_days INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, tracker_id)
);
```

### cursors
```sql
CREATE TABLE cursors (
    source_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    cursor_value TEXT NOT NULL,
    last_message_id TEXT,
    last_message_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);
```

### debug_traces
```sql
CREATE TABLE debug_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL CHECK(level IN ('ERROR', 'WARN', 'INFO', 'DEBUG')),
    component TEXT NOT NULL,
    source_id TEXT,
    tracker_id TEXT,
    message TEXT NOT NULL,
    metadata TEXT                            -- JSON
);
-- Auto-cleanup trigger deletes entries older than 30 days
```

### llm_batch_log
```sql
CREATE TABLE llm_batch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id TEXT NOT NULL,
    batch_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER NOT NULL,
    source_ids TEXT NOT NULL,                -- JSON array
    success BOOLEAN NOT NULL,
    sentiment_score REAL,
    author_count INTEGER,
    tag_counts TEXT,                         -- JSON
    processing_time_ms INTEGER,
    tokens_used INTEGER,
    cost_usd REAL,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0
);
```

### schema_migrations
```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);
```

## Indexes

- `idx_sources_tracker`, `idx_sources_platform`, `idx_sources_health`
- `idx_users_platform`, `idx_users_last_active`
- `idx_source_agg_source_bucket`, `idx_source_agg_tracker_bucket`
- `idx_tracker_agg_tracker_bucket`
- `idx_user_agg_tracker`, `idx_user_agg_messages`, `idx_user_agg_sentiment`
- `idx_debug_traces_timestamp`, `idx_debug_traces_level`
- `idx_llm_batch_tracker`, `idx_llm_batch_timestamp`

## Key Queries

```sql
-- Latest snapshot
SELECT * FROM tracker_aggregates
WHERE tracker_id = ? AND bucket = '1min'
ORDER BY bucket_start DESC LIMIT 1;

-- Time series (last 24h)
SELECT * FROM tracker_aggregates
WHERE tracker_id = ? AND bucket = '1hour'
  AND bucket_start >= datetime('now', '-24 hours')
ORDER BY bucket_start;

-- Most active users
SELECT u.*, ua.total_messages, ua.avg_sentiment
FROM user_aggregates ua JOIN users u ON ua.user_id = u.id
WHERE ua.tracker_id = ?
ORDER BY ua.total_messages DESC LIMIT 50;
```

## Backup

```bash
sqlite3 data/salt_index.db ".backup 'backup.db'"
```
