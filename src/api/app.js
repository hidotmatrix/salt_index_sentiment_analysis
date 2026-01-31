/**
 * Express Application Setup
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('../utils/logger');

class ExpressApp {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS
    this.app.use(cors());

    // Request logging
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });

    // Serve static files (dashboard)
    this.app.use(express.static(path.join(process.cwd(), 'public')));
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // Health check (public, no auth)
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Salt Index API',
        version: '1.0.0',
        description: '24/7 sentiment and signal aggregation backend',
        endpoints: {
          health: '/api/health',
          docs: '/docs'
        }
      });
    });

    // API Routes
    const trackersRouter = require('./routes/trackers');
    const sourcesRouter = require('./routes/sources');
    const dashboardRouter = require('./routes/dashboard');
    this.app.use('/api/trackers', trackersRouter);
    this.app.use('/api/sources', sourcesRouter);
    this.app.use('/api/dashboard', dashboardRouter);
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'NotFound',
        message: `Route ${req.method} ${req.path} not found`
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      logger.error(`Error: ${err.message}`, { stack: err.stack });

      res.status(err.status || 500).json({
        error: err.name || 'InternalServerError',
        message: err.message || 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });
  }

  /**
   * Get Express app instance
   */
  getApp() {
    return this.app;
  }

  /**
   * Start server
   */
  start(port) {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, (err) => {
        if (err) {
          logger.error(`Failed to start server: ${err.message}`);
          reject(err);
        } else {
          logger.info(`🚀 Salt Index API running on port ${port}`);
          logger.info(`📊 Health check: http://localhost:${port}/api/health`);
          resolve(server);
        }
      });
    });
  }
}

module.exports = new ExpressApp();
