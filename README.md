# Salt Index

**24/7 Sentiment & Signal Aggregation Backend**

Always-on monitoring and sentiment analysis for social platforms using LLM-powered insights.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

**Copy the example file:**

```bash
cp .env.example .env
```

**Edit `.env` and fill in required values:**

```bash
nano .env  # or use your preferred editor
```

**Minimum required configuration:**

```env
# REQUIRED - Get from https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE

# REQUIRED if using Telegram - Get from @BotFather
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# AUTO-GENERATED - Leave blank
ADMIN_API_KEY=
VIEW_API_KEYS=
```

### 3. Start the Server

```bash
npm start
```

On first launch:
- Auto-generates `config.toml` with example configuration
- Auto-generates API keys (admin + 10 view) and saves to `.env`
- Displays admin API key in console - **save it!**
- Initializes SQLite database

### 4. Access the Dashboard

Open your browser and enter your admin API key:
```
http://localhost:3000
```

### 5. Test the API

```bash
curl http://localhost:3000/api/health
```

---

## 📋 What You Have

### ✅ **Completed Components:**

1. **Platform Connectors**
   - ✅ Telegram Bot Integration
   - ✅ Discord Bot Integration
   - ✅ Twitter/X Integration

2. **LLM Processing**
   - ✅ OpenRouter Integration
   - ✅ Batch Processing (configurable, default 30 messages)
   - ✅ Sentiment Analysis (-100 to +100 scale)
   - ✅ Tag Extraction (60+ predefined tags)

3. **Aggregation Engine**
   - ✅ Source-level Aggregates
   - ✅ Tracker-level Aggregates (weighted)
   - ✅ User-level Aggregates
   - ✅ Time Buckets (1min, 5min, 1hour, 1day, 7day)

4. **REST API**
   - ✅ Tracker Endpoints
   - ✅ Source Endpoints
   - ✅ Snapshot API
   - ✅ Time-Series API
   - ✅ API Key Authentication

5. **Database**
   - ✅ SQLite with full schema
   - ✅ Automatic migrations
   - ✅ Cursor-based resumption
   - ✅ 30-day rolling debug traces

6. **Dashboard**
   - ✅ Minimal Web UI
   - ✅ Health monitoring
   - ✅ API documentation links




---

## 🔑 API Keys Setup

### Required (You Must Provide):

| Service | Required? | Where to Get |
|---------|-----------|-------------|
| **OpenRouter** | 🔴 YES | https://openrouter.ai/keys |
| **Telegram Bot** | 🟡 If using Telegram | @BotFather on Telegram |
| **Discord Bot** | 🟡 If using Discord | https://discord.com/developers |
| **Twitter API** | 🟡 If using Twitter | https://developer.twitter.com |

### Auto-Generated (On First Launch):

Salt Index automatically generates:
- 1 Admin API key (read-write access)
- 10 View API keys (read-only access)

**These keys are:**
- Displayed in console during first launch
- Saved to `.env` file
- Used to authenticate dashboard and API requests

**To view your admin key later:**

```bash
cat .env | grep ADMIN_API_KEY
```

---

## ⚙️ Configuration

Edit `config/config.toml` to:
- Add trackers (monitored subjects)
- Configure sources (Telegram channels, Discord servers)
- Customize enabled tags
- Adjust time buckets

**Example:**

```toml
[[trackers]]
id = "bitcoin-tracker"
name = "Bitcoin Sentiment"
enabled = true
enabled_tags = ["optimism", "fear", "hype", "FUD"]
time_buckets = ["1min", "1hour", "1day"]

[[sources]]
id = "telegram-btc"
tracker_id = "bitcoin-tracker"
platform = "telegram"
target = "@bitcoin"
weight = 1.0
```

---

## 🧪 Testing

### Quick Test:

1. **Send message to bot**:
   - Open Telegram
   - Message `@salt_indexbot`
   - Send: "This is a test! I'm excited!"

2. **Check logs**:
   ```bash
   tail -f logs/salt-index.log
   ```

3. **Query API**:
   ```bash
   curl -H "Authorization: Bearer YOUR_ADMIN_KEY" \
        http://localhost:3000/api/trackers
   ```

---

## 📊 API Examples

### Get Tracker Snapshot

```bash
curl -H "Authorization: Bearer YOUR_KEY" \
     "http://localhost:3000/api/trackers/test-tracker/snapshot?bucket=1hour"
```

**Response:**
```json
{
  "tracker_id": "test-tracker",
  "metrics": {
    "sentiment": { "score": 45.2 },
    "volume": {
      "message_count": 124,
      "author_count": 87
    },
    "tags": {
      "optimism": 45,
      "excitement": 32,
      "fear": 12
    }
  }
}
```

### Get Time Series

```bash
curl -H "Authorization: Bearer YOUR_KEY" \
     "http://localhost:3000/api/trackers/test-tracker/timeseries?bucket=1hour&from=2026-01-30T00:00:00Z"
```

See [docs/API_SCHEMA.md](docs/API_SCHEMA.md) for complete API documentation.

---

## 📖 Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture
- **[docs/API_SCHEMA.md](docs/API_SCHEMA.md)** - Complete API reference
- **[docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)** - Database structure
- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** - Configuration guide
- **[docs/SETUP.md](docs/SETUP.md)** - Setup and deployment guide

---

## 🛠️ Development

### Run in Development Mode

```bash
npm run dev
```

Uses `nodemon` for auto-restart on file changes.

### Check Database

```bash
sqlite3 data/salt_index.db
SELECT * FROM trackers;
.exit
```

### View Logs

```bash
# All logs
tail -f logs/salt-index.log

# Errors only
tail -f logs/error.log
```

---

## 🔧 Troubleshooting

### Bot Not Receiving Messages

**Telegram:**
- Add bot as admin in channel
- Grant "Read Messages" permission
- Or send direct message to `@salt_indexbot`

**Discord:**
- Enable "Message Content Intent" in bot settings
- Make sure bot is in server and has permissions

### LLM Processing Fails

- Check `OPENROUTER_API_KEY` in `.env`
- Verify OpenRouter account has credits
- Check logs for specific error

### No Data in API

- Wait for batch processing (default: 60 seconds timeout, configurable via `BATCH_TIMEOUT`)
- Messages are batched until either:
  - `BATCH_SIZE` messages collected (default: 30), OR
  - `BATCH_TIMEOUT` seconds elapsed (default: 60)
- Check logs for "Processing batch"
- Verify messages reached connectors (check logs for "queued")

---

## 🚀 Deployment

### Using Docker (Recommended)

```bash
# Build image
docker build -t salt-index .

# Run container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  salt-index
```

### Using PM2

```bash
npm install -g pm2
pm2 start src/index.js --name salt-index
pm2 logs salt-index
```

---

## 📝 Environment Variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

### Manual Configuration (Required):

```bash
# REQUIRED for LLM processing
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# REQUIRED if using Telegram
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# OPTIONAL - Only if using Discord
DISCORD_BOT_TOKEN=MTQ2N...

# OPTIONAL - Only if using Twitter
TWITTER_BEARER_TOKEN=...
```

### Auto-Generated (Leave Blank):

```bash
# These are filled automatically on first launch
ADMIN_API_KEY=
VIEW_API_KEYS=
```

### Optional Settings:

```bash
PORT=3000
NODE_ENV=development
DATABASE_PATH=./data/salt_index.db

# Batch Processing
BATCH_SIZE=30              # Number of messages to batch for LLM processing
BATCH_TIMEOUT=60           # Maximum time (seconds) to wait before processing incomplete batch

# Logging & Debugging
LOG_LEVEL=info
DEBUG_TRACE_RETENTION_DAYS=30
```

See [`.env.example`](.env.example) for complete documentation with explanations for each variable.

---

## 🎯 Features

- ✅ Real-time message monitoring
- ✅ LLM-powered sentiment analysis
- ✅ Multi-platform support (Telegram, Discord, Twitter/X)
- ✅ Weighted aggregation across sources
- ✅ Time-bucketed statistics
- ✅ User-level tracking
- ✅ REST API with authentication
- ✅ SQLite database (no external DB needed)
- ✅ Auto-resumption after restarts
- ✅ Configurable tag system
- ✅ Web dashboard

---

## 🔐 Security

- API keys auto-generated on first launch
- Keys stored in `.env` (gitignored)
- Admin vs view-only access levels
- No raw message storage (only aggregates)

---

## 📊 Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite3
- **LLM**: OpenRouter (Claude, GPT, Llama, etc.)
- **Platforms**: Telegram Bot API, Discord.js, Twitter API v2
- **Logging**: Winston

---


## 📄 License

MIT

---

## 🆘 Support

- Check logs: `tail -f logs/salt-index.log`
- Read docs in `docs/` folder
- See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions

---

**Built with ❤️ using Node.js, Express, and SQLite**

**Bot**: `@salt_indexbot` on Telegram
