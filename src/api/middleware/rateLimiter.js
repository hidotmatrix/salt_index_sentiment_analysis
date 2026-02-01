/**
 * Rate Limiting Middleware
 * Simple in-memory rate limiter
 */
const logger = require('../../utils/logger');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.maxRequests = options.maxRequests || 100;
    this.requests = new Map();

    // Cleanup old entries every minute
    setInterval(() => this.cleanup(), this.windowMs);
  }

  /**
   * Create rate limiting middleware
   */
  limit() {
    return (req, res, next) => {
      // Use API key or IP address as identifier
      const identifier = this.getIdentifier(req);

      // Get or create request tracking
      const now = Date.now();
      if (!this.requests.has(identifier)) {
        this.requests.set(identifier, []);
      }

      const userRequests = this.requests.get(identifier);

      // Filter out expired requests
      const validRequests = userRequests.filter(
        timestamp => now - timestamp < this.windowMs
      );

      // Check if limit exceeded
      if (validRequests.length >= this.maxRequests) {
        logger.warn(`Rate limit exceeded for ${identifier}`);
        return res.status(429).json({
          error: 'TooManyRequests',
          message: `Rate limit exceeded. Maximum ${this.maxRequests} requests per ${this.windowMs / 1000} seconds.`,
          retryAfter: Math.ceil((validRequests[0] + this.windowMs - now) / 1000)
        });
      }

      // Add current request
      validRequests.push(now);
      this.requests.set(identifier, validRequests);

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', this.maxRequests - validRequests.length);
      res.setHeader('X-RateLimit-Reset', Math.ceil((validRequests[0] + this.windowMs) / 1000));

      next();
    };
  }

  /**
   * Get identifier for rate limiting
   */
  getIdentifier(req) {
    // Try API key first
    if (req.user && req.user.type) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7, 17); // First 10 chars of API key
      }
    }

    // Fall back to IP address
    return req.ip || req.connection.remoteAddress || 'unknown';
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [identifier, timestamps] of this.requests.entries()) {
      const validRequests = timestamps.filter(
        timestamp => now - timestamp < this.windowMs
      );
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }
}

module.exports = RateLimiter;
