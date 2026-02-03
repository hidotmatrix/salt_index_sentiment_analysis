# Salt Index - Configuration

## Files

- `.env` - API keys, secrets, runtime settings
- `config/config.toml` - Trackers, sources, tags

## Environment Variables (.env)

```env
# Required
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# Platform tokens (only needed if using that platform)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
TWITTER_BEARER_TOKEN=...

# Auto-generated on first launch (leave blank)
ADMIN_API_KEY=
VIEW_API_KEYS=

# Optional
PORT=3000
DATABASE_PATH=./data/salt_index.db
BATCH_SIZE=30
BATCH_TIMEOUT=60
LOG_LEVEL=info
```

## TOML Configuration (config/config.toml)

### Master Tags

```toml
[tags.core_emotions]
tags = ["anger", "fear", "optimism", "excitement", "happiness", "sadness"]

[tags.narrative]
tags = ["hype", "FUD", "speculation", "panic"]

[tags.credibility]
tags = ["spam", "bot", "scam", "phishing", "misinformation"]
```

### Default Settings

```toml
[default_settings]
enabled_tags = ["optimism", "fear", "hype", "FUD", "spam", "bot"]
excluded_from_sentiment = ["spam", "bot", "scam", "phishing"]

[aggregation]
time_buckets = ["1min", "5min", "1hour", "1day", "7day"]

[llm]
batch_size = 30
batch_timeout_seconds = 60
```

### Trackers

```toml
[[trackers]]
id = "my-tracker"
name = "My Tracker"
description = "Optional description"
enabled = true
enabled_tags = ["optimism", "fear", "hype", "FUD"]
time_buckets = ["1min", "1hour", "1day"]
```

### Sources

**Telegram:**
```toml
[[sources]]
id = "telegram-source"
tracker_id = "my-tracker"
platform = "telegram"
target = "@channelname"
weight = 1.0
paused = false

[sources.config]
monitor_forwards = true
```

**Discord:**
```toml
[[sources]]
id = "discord-source"
tracker_id = "my-tracker"
platform = "discord"
target = "server:MyServer/channel:general"
weight = 0.8

[sources.config]
server_id = "123456789012345678"
channel_id = "987654321098765432"
```

**Twitter:**
```toml
[[sources]]
id = "twitter-source"
tracker_id = "my-tracker"
platform = "twitter"
target = "search:bitcoin"
weight = 0.7

[sources.config]
query = "bitcoin OR #btc"
mode = "search"           # "search" (polling) or "stream" (requires Pro tier)
poll_interval = 60
max_results = 10
```

### Operational Settings

```toml
[operations]
health_check_interval = 60
failure_threshold = 5
retry_max_attempts = 5

[retention]
debug_traces_days = 30
llm_batch_logs_days = 90
```

## Hot Reload

```bash
curl -X POST -H "Authorization: Bearer ADMIN_KEY" \
  http://localhost:3000/api/admin/reload-config
```

Note: Source credential changes require restart.
