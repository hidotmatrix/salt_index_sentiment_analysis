# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start with nodemon (auto-restart on changes)
npm start            # Production start

# Database inspection
sqlite3 data/salt_index.db "SELECT * FROM trackers;"

# Logs
tail -f logs/salt-index.log        # All logs
tail -f logs/error.log             # Errors only

# API testing
curl http://localhost:3000/api/health
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/api/trackers

# Hot reload config (no restart needed)
curl -X POST -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/api/admin/reload-config
```

## Architecture

Salt Index is a sentiment analysis backend that monitors social platforms (Telegram, Discord, Twitter), processes messages through an LLM, and exposes aggregated statistics via REST API.

### Data Flow

```
Platform → Connector → In-memory Queue → BatchProcessor → LLM → AggregationEngine → SQLite → API
```

### Key Components

**Connectors** (`src/connectors/`): Platform-specific message collectors. Each extends `BaseConnector`. Telegram uses a shared singleton `TelegramBotManager` because Telegram only allows one polling connection per bot token.

**LLM Processing** (`src/llm/`): `BatchProcessor` queues messages and triggers processing at 30 messages or 60s timeout. `OpenRouterClient` calls the LLM and parses structured JSON responses (sentiment -100 to +100, tags, per-user summaries).

**Aggregation** (`src/aggregation/AggregationEngine.js`): Three levels - Source (per-platform), Tracker (weighted across sources), User (per-platform, no cross-platform matching). Time buckets: 1min, 5min, 1hour, 1day, 7day.

**API** (`src/api/`): Express.js with Bearer token auth. Admin key has write access, view keys are read-only. Keys auto-generated on first launch.

### Configuration

- `.env` - API keys, secrets, runtime settings (LOG_LEVEL, BATCH_SIZE, BATCH_TIMEOUT)
- `config/config.toml` - Trackers, sources, tags, time buckets

### Telegram Topics

Telegram sources support forum topics via target format `@GroupName/TopicId`:
- `@NervosNation/1` - General topic (ID 1)
- `@NervosNation/295370` - Specific topic
- `@NervosNation` - All messages (no topic filter)

## Code Style

- Use tabs for indentation
- JSDoc comments on public methods
- Winston logger (`require('../utils/logger')`) for all logging
- Connectors report health status: healthy/degraded/failed

## Architecture Decisions

See `DECISIONS.md` for documented architecture decisions.
