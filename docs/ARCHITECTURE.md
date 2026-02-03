# Salt Index - Architecture

## Overview

Salt Index monitors social platforms (Telegram, Discord, Twitter), processes messages via LLM for sentiment analysis, and stores aggregated statistics accessible via REST API.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SALT INDEX                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    PLATFORM CONNECTORS                           │  │
│   │                                                                  │  │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │  │
│   │   │   Telegram   │  │   Discord    │  │   Twitter    │           │  │
│   │   │  Connector   │  │  Connector   │  │  Connector   │           │  │
│   │   │              │  │              │  │              │           │  │
│   │   │ Bot API      │  │ discord.js   │  │ twitter-api  │           │  │
│   │   │ Polling      │  │ Events       │  │ Search/Stream│           │  │
│   │   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │  │
│   │          │                 │                 │                   │  │
│   │          └─────────────────┼─────────────────┘                   │  │
│   │                            │                                     │  │
│   │                    ┌───────▼───────┐                             │  │
│   │                    │ ConnectorMgr  │                             │  │
│   │                    └───────┬───────┘                             │  │
│   └────────────────────────────┼─────────────────────────────────────┘  │
│                                │                                        │
│                                │ messages (every Xsec {Configurable})   │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    LLM PROCESSING                                │  │
│   │                                                                  │  │
│   │   ┌──────────────┐       ┌──────────────┐       ┌─────────────┐  │  │
│   │   │    Batch     │──────▶│  OpenRouter  │──────▶│   Parser    │  │  │
│   │   │  Processor   │       │     LLM      │       │             │  │  │
│   │   │              │       │              │       │ sentiment   │  │  │
│   │   │ 30 msgs or   │       │ Claude/GPT   │       │ + tags      │  │  │
│   │   │ 60s timeout  │       │              │       │ + per-user  │  │  │
│   │   └──────────────┘       └──────────────┘       └──────┬──────┘  │  │
│   └────────────────────────────┼─────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    AGGREGATION ENGINE                            │  │
│   │                                                                  │  │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │  │
│   │   │    Source    │  │   Tracker    │  │     User     │           │  │
│   │   │  Aggregates  │  │  Aggregates  │  │  Aggregates  │           │  │
│   │   │              │  │  (weighted)  │  │ (per-platform)│          │  │
│   │   └──────────────┘  └──────────────┘  └──────────────┘           │  │
│   │                                                                  │  │
│   │   Time Buckets: 1min | 5min | 1hour | 1day | 7day                │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    STORAGE (SQLite)                              │  │
│   │                                                                  │  │
│   │   trackers | sources | users | cursors | aggregates | batch_log  │  │
│   │                                                                  │  │
│   │   ✓ Aggregates only (no raw messages)                            │  │
│   │   ✓ Cursors for resume                                           │  │
│   │   ✓ 30-day debug traces                                          │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    API LAYER (Express)                           │  │
│   │                                                                  │  │
│   │   Auth: Bearer token (admin key / view keys)                     │  │
│   │                                                                  │  │
│   │   /api/health          (public)                                  │  │
│   │   /api/trackers        list, get, snapshot, timeseries, delete   │  │
│   │   /api/sources         list, get, snapshot, delete               │  │
│   │   /api/users           list, get, history, top/active            │  │
│   │   /api/dashboard       system overview                           │  │
│   │   /api/admin           stats, cleanup, reload-config             │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### Platform Connectors (`src/connectors/`)

| Connector | Library | Method | Dedup Key |
|-----------|---------|--------|-----------|
| Telegram | `node-telegram-bot-api` | Polling | message_id |
| Discord | `discord.js` | Events | snowflake ID |
| Twitter | `twitter-api-v2` | Search polling / Stream | tweet ID |

Each connector:
- Deduplicates via `seenMessages` Set
- Stores cursor in DB for resume after restart
- Reports health_status (healthy/degraded/failed)

### LLM Processing (`src/llm/`)

- **BatchProcessor**: Queues messages, triggers at 30 msgs or 60s timeout
- **OpenRouterClient**: Calls LLM API, parses structured JSON response
- Output: sentiment (-100 to +100), tag counts, per-user summaries

### Aggregation Engine (`src/aggregation/`)

Three levels:
- **Source**: Direct aggregates per platform source
- **Tracker**: Weighted average across sources (configurable weights 0-1)
- **User**: Per-user stats scoped by platform (no cross-platform matching)

### Storage (`src/db/`)

SQLite with WAL mode. Tables:
- `trackers`, `sources`, `users` - config/entities
- `source_aggregates`, `tracker_aggregates`, `user_aggregates` - time-bucketed stats
- `cursors` - resume points
- `debug_traces`, `llm_batch_log` - operational logs

### API Layer (`src/api/`)

Express.js with:
- API key auth (1 admin + 10 view keys, auto-generated)
- CORS enabled
- Static dashboard at `/public`

## Data Flow

```
Platform → Connector → Queue (in-memory) → Batcher → LLM → Aggregation → SQLite → API
              ↓
         Dedup + Cursor
```

## Key Files

```
src/
├── index.js              # Main entry, orchestrates startup
├── connectors/
│   ├── ConnectorManager.js
│   ├── TelegramConnector.js
│   ├── DiscordConnector.js
│   └── TwitterConnector.js
├── llm/
│   ├── BatchProcessor.js
│   └── OpenRouterClient.js
├── aggregation/
│   └── AggregationEngine.js
├── db/
│   ├── index.js
│   └── schema.sql
├── api/
│   ├── app.js
│   ├── middleware/auth.js
│   └── routes/{trackers,sources,users,dashboard,admin}.js
└── config/
    ├── loader.js
    └── generator.js
```

## Configuration

- `.env` - API keys, secrets, runtime settings
- `config/config.toml` - Trackers, sources, tags, buckets

## Deployment

Single-instance Docker or PM2. No external dependencies except platform APIs and OpenRouter.

```bash
# Docker
docker run -d -p 3000:3000 -v ./data:/app/data --env-file .env salt-index

# PM2
pm2 start src/index.js --name salt-index
```
