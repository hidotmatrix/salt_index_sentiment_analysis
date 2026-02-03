# Salt Index - Technical Decisions

## Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Language | Node.js (not Rust) | Faster dev, mature platform libraries |
| Database | SQLite | Simple ops, file-based, sufficient for single-instance |
| Queue | In-memory | No external deps, cursor-based resume handles restarts |
| Web Framework | Express.js | Mature, battle-tested, large ecosystem |
| LLM Provider | OpenRouter | Multi-model access, pay-per-use |
| Auth | API Keys | Stateless, simple, sufficient for backend service |
| Dashboard | Vanilla HTML/JS | No build step, minimal needs |
| Config | TOML | Human-readable, strongly typed |
| Storage | Aggregates only | Privacy, efficiency, fast queries |

## Key Trade-offs

### Node.js over Rust
- **Pro**: Faster development, mature libraries for Telegram/Discord/Twitter
- **Con**: Higher memory (~100-200MB vs ~20MB), slower execution
- **Verdict**: LLM API calls are the bottleneck, not language speed

### SQLite over PostgreSQL
- **Pro**: Zero config, file-based backup, embedded
- **Con**: No horizontal scaling, no built-in replication
- **Verdict**: Perfect for single-instance, can migrate later if needed

### In-memory Queue over Redis
- **Pro**: No external service, fastest access
- **Con**: Queue lost on crash
- **Verdict**: Cursor-based resume re-fetches messages anyway

### Aggregates Only (No Raw Messages)
- **Pro**: Privacy-friendly, 50x storage savings, instant queries
- **Con**: Can't re-analyze historical messages
- **Verdict**: Matches project requirements for aggregated statistics

## Brief Alignment

| Aspect | Brief | Actual | Match |
|--------|-------|--------|-------|
| Backend | Rust preferred | Node.js | No (pragmatic) |
| Database | SQLite preferred | SQLite | Yes |
| Queue | Redis optional | In-memory | Yes |
| Config | TOML | TOML | Yes |
| LLM | OpenRouter | OpenRouter | Yes |
| Auth | API keys | API keys | Yes |
| Storage | Aggregates only | Aggregates only | Yes |
| Docker | Preferred | Supported | Yes |

