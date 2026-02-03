# Salt Index - Setup Guide

## Prerequisites

- Node.js v18+
- OpenRouter API key (required): https://openrouter.ai/keys
- Platform tokens (as needed): Telegram (@BotFather), Discord (developer portal), Twitter (developer portal)

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

First launch auto-generates config.toml and API keys.

## Platform Setup

### Telegram
1. Message @BotFather → `/newbot`
2. Copy token to `.env`: `TELEGRAM_BOT_TOKEN=...`
3. Add bot to channel/group (as admin for private channels)

### Discord
1. Create app at https://discord.com/developers/applications
2. Enable "Message Content Intent" in Bot settings
3. Copy token to `.env`: `DISCORD_BOT_TOKEN=...`
4. Invite bot with Read Messages permission

### Twitter
1. Apply at https://developer.twitter.com
2. Get Bearer Token
3. Add to `.env`: `TWITTER_BEARER_TOKEN=...`

Note: Twitter API requires paid tier ($100+/month for Basic).

## Configure Sources

Edit `config/config.toml`:

```toml
[[sources]]
id = "my-source"
tracker_id = "example-tracker"
platform = "telegram"  # or "discord", "twitter"
target = "@channelname"
weight = 1.0

[sources.config]
# Platform-specific config
```

Reload without restart:
```bash
curl -X POST -H "Authorization: Bearer ADMIN_KEY" \
  http://localhost:3000/api/admin/reload-config
```

## Running

```bash
# Development
npm run dev

# Production with PM2
npm install -g pm2
pm2 start src/index.js --name salt-index
pm2 startup
```

## Docker

```bash
docker build -t salt-index .
docker run -d -p 3000:3000 \
  -v ./data:/app/data \
  -v ./config:/app/config \
  --env-file .env \
  salt-index
```

## Logs

```bash
tail -f logs/salt-index.log
tail -f logs/error.log
```

## Maintenance

```bash
# Backup database
sqlite3 data/salt_index.db ".backup 'backup.db'"

# Cleanup
curl -X POST -H "Authorization: Bearer ADMIN_KEY" \
  http://localhost:3000/api/admin/cleanup
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not receiving | Check bot is admin, has read permissions |
| LLM failing | Check OpenRouter credits and API key |
| No sentiment data | Wait for batch (30 msgs or 60s timeout) |
| Permission denied | `chmod -R 755` on project directory |
