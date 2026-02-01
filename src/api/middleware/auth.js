/**
 * API Authentication Middleware
 * Validates API keys and enforces admin vs view-only permissions
 */
const logger = require('../../utils/logger');

class AuthMiddleware {
  constructor(config) {
    this.adminKey = config.env.apiKeys.admin;
    this.viewKeys = config.env.apiKeys.view;

    if (!this.adminKey || this.viewKeys.length === 0) {
      logger.warn('API keys not configured - authentication disabled!');
    }
  }

  /**
   * Authenticate request and set permission level
   */
  authenticate(options = {}) {
    return (req, res, next) => {
      // Check if this route is public
      if (options.public) {
        return next();
      }

      // Extract API key from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>'
        });
      }

      const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Check if admin key
      if (apiKey === this.adminKey) {
        req.user = {
          type: 'admin',
          permissions: ['read', 'write', 'delete']
        };
        logger.debug('Admin authenticated');
        return next();
      }

      // Check if view key
      if (this.viewKeys.includes(apiKey)) {
        req.user = {
          type: 'view',
          permissions: ['read']
        };
        logger.debug('View user authenticated');
        return next();
      }

      // Invalid key
      logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
    };
  }

  /**
   * Require admin permissions
   */
  requireAdmin(req, res, next) {
    if (!req.user || req.user.type !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin permissions required for this operation'
      });
    }
    next();
  }

  /**
   * Check if user has specific permission
   */
  requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user || !req.user.permissions.includes(permission)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Permission '${permission}' required for this operation`
        });
      }
      next();
    };
  }
}

module.exports = AuthMiddleware;
