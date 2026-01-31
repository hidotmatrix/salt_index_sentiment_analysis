/**
 * Logger utility using Winston
 */
const winston = require('winston');
const path = require('path');

const logLevel = process.env.LOG_LEVEL || 'info';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    return stack ? `${msg}\n${stack}` : msg;
  })
);

// Create logger
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // File output - all logs
    new winston.transports.File({
      filename: path.join('logs', 'salt-index.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // File output - errors only
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

module.exports = logger;
