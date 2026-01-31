/**
 * Configuration Generator
 * Auto-generates config.toml and API keys on first launch
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ConfigGenerator {
  /**
   * Generate API keys
   */
  generateApiKeys() {
    const adminKey = `sk_admin_${crypto.randomBytes(24).toString('hex')}`;
    const viewKeys = Array.from({ length: 10 }, () =>
      `sk_view_${crypto.randomBytes(24).toString('hex')}`
    );

    return { adminKey, viewKeys };
  }

  /**
   * Update .env file with generated API keys
   */
  updateEnvFile(adminKey, viewKeys) {
    const envPath = path.join(process.cwd(), '.env');

    if (!fs.existsSync(envPath)) {
      logger.error('.env file not found!');
      return;
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    // Update admin key
    envContent = envContent.replace(
      /ADMIN_API_KEY=.*/,
      `ADMIN_API_KEY=${adminKey}`
    );

    // Update view keys
    envContent = envContent.replace(
      /VIEW_API_KEYS=.*/,
      `VIEW_API_KEYS=${viewKeys.join(',')}`
    );

    fs.writeFileSync(envPath, envContent);
    logger.info('API keys saved to .env file');
  }

  /**
   * Generate default config.toml
   */
  generateConfigToml() {
    const configPath = path.join('config', 'config.toml');

    // Check if config already exists
    if (fs.existsSync(configPath)) {
      logger.info('config.toml already exists, skipping generation');
      return;
    }

    // Ensure config directory exists
    if (!fs.existsSync('config')) {
      fs.mkdirSync('config', { recursive: true });
    }

    const configTemplate = `# ============================================================
# SALT INDEX - Configuration File
# ============================================================
# This file is auto-generated on first launch.
# Edit carefully - changes take effect after service restart.
#
# Configuration changes continue from last-seen cursor
# (no historical data is lost or re-processed).
# ============================================================

version = "1.0.0"

# ============================================================
# MASTER TAG LIST
# ============================================================

[tags.tone_and_style]
enabled = true
tags = ["sarcasm", "irony", "satire", "joke", "serious"]

[tags.core_emotions]
enabled = true
tags = [
    "anger", "rage", "frustration", "disappointment", "sadness",
    "fear", "anxiety", "hope", "optimism", "enthusiasm",
    "excitement", "happiness"
]

[tags.social_and_interpersonal]
enabled = true
tags = [
    "support", "praise", "gratitude", "helpful", "compassion",
    "respect", "hostility", "bullying", "harassment", "threat", "toxic"
]

[tags.conversation_function]
enabled = true
tags = [
    "agreement", "disagreement", "question", "answer",
    "clarification", "suggestion", "request", "warning"
]

[tags.credibility_and_manipulation]
enabled = true
tags = [
    "spam", "bot", "scam", "phishing", "misinformation",
    "manipulation", "brigading"
]

[tags.narrative_and_amplification]
enabled = true
tags = [
    "hype", "FUD", "sensationalism", "rumor",
    "speculation", "panic", "urgency"
]

[tags.promotion_and_marketing]
enabled = true
tags = ["promotion", "shilling", "advertising"]

# ============================================================
# DEFAULT SETTINGS
# ============================================================

[default_settings]
enabled_tags = [
    # Core emotions
    "optimism", "fear", "excitement", "happiness", "sadness",
    "anger", "disappointment",
    # Narrative
    "hype", "FUD", "speculation", "panic",
    # Social
    "support", "praise",
    # Conversation
    "agreement", "disagreement", "question",
    # Credibility
    "spam", "bot", "scam", "phishing", "misinformation"
]

excluded_from_sentiment = ["spam", "bot", "scam", "phishing"]

# ============================================================
# AGGREGATION SETTINGS
# ============================================================

[aggregation]
time_buckets = ["1min", "5min", "1hour", "1day", "7day"]

# ============================================================
# LLM BATCHING
# ============================================================

[llm]
batch_size = 30
batch_timeout_seconds = 60
max_context_messages = 5

# ============================================================
# TRACKERS - Define your monitoring targets here
# ============================================================

# Example tracker (you can add your own)
[[trackers]]
id = "example-tracker"
name = "Example Tracker"
description = "Example sentiment tracker - edit or remove this"
enabled = true
enabled_tags = [
    "optimism", "fear", "excitement", "hype", "FUD",
    "support", "spam", "bot"
]
excluded_from_sentiment = []
time_buckets = ["1min", "5min", "1hour", "1day"]

# ============================================================
# SOURCES - Define platform connections here
# ============================================================

# Example Telegram source
# [[sources]]
# id = "telegram-example"
# tracker_id = "example-tracker"
# platform = "telegram"
# target = "@example_channel"
# weight = 1.0
# paused = false
#
# [sources.config]
# channel_id = -1001234567890
# monitor_forwards = true

# Example Discord source
# [[sources]]
# id = "discord-example"
# tracker_id = "example-tracker"
# platform = "discord"
# target = "server:MyServer/channel:general"
# weight = 0.8
# paused = false
#
# [sources.config]
# server_id = "123456789012345678"
# channel_id = "987654321098765432"

# ============================================================
# OPERATIONAL SETTINGS
# ============================================================

[operations]
health_check_interval = 60
failure_threshold = 5
retry_initial_delay_ms = 1000
retry_max_delay_ms = 60000
retry_max_attempts = 5

# ============================================================
# DATA RETENTION
# ============================================================

[retention]
debug_traces_days = 30
llm_batch_logs_days = 90
aggregates_retention_days = 0  # 0 = infinite
`;

    fs.writeFileSync(configPath, configTemplate);
    logger.info('Generated default config.toml');
  }

  /**
   * Generate all configuration on first launch
   */
  async generateAll() {
    logger.info('🚀 First launch detected - generating configuration...');

    // Generate config.toml
    this.generateConfigToml();

    // Check if API keys already exist in .env
    const hasAdminKey = process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.trim() !== '';

    if (!hasAdminKey) {
      // Generate API keys
      const { adminKey, viewKeys } = this.generateApiKeys();

      // Update .env
      this.updateEnvFile(adminKey, viewKeys);

      // Display keys
      this.displayKeys(adminKey, viewKeys);
    } else {
      logger.info('API keys already exist in .env, skipping generation');
    }

    logger.info('✅ Configuration generation complete!');
  }

  /**
   * Display generated API keys
   */
  displayKeys(adminKey, viewKeys) {
    console.log('\n' + '='.repeat(60));
    console.log('SALT INDEX - Generated API Keys');
    console.log('='.repeat(60));
    console.log('\n⚠️  SAVE THESE KEYS SECURELY - They are saved in .env\n');

    console.log('Admin Key (read-write access):');
    console.log(`  ${adminKey}\n`);

    console.log('View Keys (read-only access):');
    viewKeys.forEach((key, index) => {
      console.log(`  ${index + 1}. ${key}`);
    });

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

module.exports = new ConfigGenerator();
