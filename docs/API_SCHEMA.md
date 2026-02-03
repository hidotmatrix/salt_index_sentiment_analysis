# Salt Index - API Reference

Base URL: `http://localhost:3000/api`

## Authentication

All endpoints except `/api/health` require:
```
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### Health (Public)

```
GET /api/health
```

### Trackers

```
GET /api/trackers                              # List all
GET /api/trackers/:id                          # Get one with sources
GET /api/trackers/:id/snapshot?bucket=1min     # Current snapshot
GET /api/trackers/:id/timeseries?bucket=1hour&from=ISO_DATE&to=ISO_DATE
DELETE /api/trackers/:id/statistics            # Delete all stats (admin)
DELETE /api/trackers/:id/statistics/:bucket?from=&to=  # Delete bucket stats (admin)
```

### Sources

```
GET /api/sources                               # List all
GET /api/sources?tracker_id=X&platform=telegram&health=healthy
GET /api/sources/:id                           # Get one with cursor
GET /api/sources/:id/snapshot?bucket=1min      # Current snapshot
DELETE /api/sources/:id/statistics             # Delete stats (admin)
```

### Users

```
GET /api/users                                 # List with filters
GET /api/users?platform=telegram&tracker_id=X&min_messages=10&max_messages=100
GET /api/users?min_sentiment=-50&max_sentiment=50&tag=optimism
GET /api/users?sort_by=total_messages&order=desc&limit=100&offset=0
GET /api/users/:id                             # Get one (id = platform:user_id)
GET /api/users/:id/sentiment-history?tracker_id=X
GET /api/users/top/active?tracker_id=X&limit=50
```

**User filter params:**
- `platform` - telegram, discord, twitter
- `tracker_id` - filter by tracker
- `min_messages`, `max_messages` - message count range
- `min_sentiment`, `max_sentiment` - sentiment range (-100 to 100)
- `tag` - filter users with specific tag
- `sort_by` - total_messages, avg_sentiment, last_message_at, first_message_at
- `order` - asc, desc (default: desc)
- `limit` - max 1000 (default: 100)
- `offset` - pagination offset

### Dashboard

```
GET /api/dashboard                             # System overview (view key OK)
```

### Admin (Admin key required)

```
GET /api/admin/stats                           # System stats
POST /api/admin/cleanup                        # Trigger cleanup
POST /api/admin/reload-config                  # Reload config.toml
```

**Cleanup request body:**
```json
{ "target": "debug_traces" | "old_batches" | "all" }
```

## Response Examples

### Tracker List
```json
{
  "trackers": [{
    "id": "my-tracker",
    "name": "My Tracker",
    "enabled": true,
    "source_count": 3,
    "health": { "status": "healthy", "healthy_sources": 3 }
  }],
  "total": 1
}
```

### Snapshot
```json
{
  "tracker_id": "my-tracker",
  "bucket": "1min",
  "window": { "start": "...", "end": "..." },
  "metrics": {
    "sentiment": { "score": 45 },
    "volume": { "message_count": 124, "author_count": 87 },
    "tags": { "optimism": 45, "fear": 12 },
    "sources": [{ "source_id": "...", "weight": 1.0, "contribution": 0.6 }]
  }
}
```

### Time Series
```json
{
  "tracker_id": "my-tracker",
  "bucket": "1hour",
  "window": { "from": "...", "to": "..." },
  "data_points": 24,
  "series": [
    { "timestamp": "...", "sentiment": 45, "message_count": 100, "author_count": 50, "tags": {...} }
  ]
}
```

### User
```json
{
  "id": "telegram:123456",
  "platform": "telegram",
  "username": "user123",
  "aggregates": [{
    "tracker_id": "my-tracker",
    "total_messages": 50,
    "avg_sentiment": 32,
    "tag_counts": { "optimism": 20, "hype": 15 },
    "first_message_at": "...",
    "last_message_at": "..."
  }]
}
```

### Dashboard
```json
{
  "timestamp": "...",
  "system": { "total_platforms": 3, "connected": 2, "messages_today": 500 },
  "queue": { "pending": 5, "processing": false },
  "sentiment": { "score": 45, "message_count": 100, "tags": {...} },
  "sources": [{ "platform": "telegram", "connected": true, "messages_today": 200 }],
  "recent_batches": [{ "message_count": 30, "processing_time_ms": 1500 }]
}
```

### Admin Stats
```json
{
  "timestamp": "...",
  "database": {
    "trackers": 2, "sources": 5, "users": 150,
    "total_messages_processed": 5000,
    "size_mb": "12.50"
  },
  "queue": { "pending": 0 },
  "uptime_seconds": 3600,
  "memory_usage": { "heapUsed": 50000000 }
}
```

## Errors

```json
{ "error": "Unauthorized", "message": "Invalid API key" }
{ "error": "NotFound", "message": "Tracker not found" }
{ "error": "Forbidden", "message": "Admin permissions required" }
{ "error": "BadRequest", "message": "bucket and from parameters are required" }
```

## Status Codes

- `200` Success
- `400` Bad request (missing/invalid params)
- `401` Invalid/missing API key
- `403` Insufficient permissions (admin required)
- `404` Not found
- `500` Server error
