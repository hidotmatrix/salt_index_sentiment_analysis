# Architecture Decisions

## 2026-02-03: Telegram Multi-Topic Support

### Context
The Telegram connector was creating separate bot instances for each configured source, causing 409 Conflict errors because Telegram only allows one polling connection per bot token.

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Topic filtering | Strict - each source receives only messages from its specified topic | Clean separation, predictable behavior |
| Messages without thread ID | Route to topic ID 1 (General) sources only | Matches Telegram's General topic behavior |
| Multiple bot tokens | Deferred - single token per app for now | Not currently needed, can add later |
| Shared bot failure handling | Acceptable - all Telegram sources fail together | Unavoidable given Telegram's single-polling constraint |

### Implementation
- Created `TelegramBotManager.js` - singleton managing shared bot instance
- Refactored `TelegramConnector.js` - registers with manager instead of own polling
- Messages routed based on `message_thread_id` field
