/**
 * Users API Routes
 * Query users by activity, tags, and sentiment
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * GET /api/users
 * List users with filtering and sorting
 */
router.get('/', async (req, res) => {
  try {
    const {
      platform,
      tracker_id,
      min_messages,
      max_messages,
      min_sentiment,
      max_sentiment,
      tag,
      sort_by,
      order,
      limit,
      offset
    } = req.query;

    // Build query
    let query = `
      SELECT u.*, ua.total_messages, ua.avg_sentiment, ua.tag_counts,
             ua.first_message_at, ua.last_message_at, ua.tracker_id
      FROM users u
      LEFT JOIN user_aggregates ua ON u.id = ua.user_id
      WHERE 1=1
    `;
    const params = [];

    // Platform filter
    if (platform) {
      query += ' AND u.platform = ?';
      params.push(platform);
    }

    // Tracker filter
    if (tracker_id) {
      query += ' AND ua.tracker_id = ?';
      params.push(tracker_id);
    }

    // Message count filters
    if (min_messages) {
      query += ' AND ua.total_messages >= ?';
      params.push(parseInt(min_messages));
    }
    if (max_messages) {
      query += ' AND ua.total_messages <= ?';
      params.push(parseInt(max_messages));
    }

    // Sentiment filters
    if (min_sentiment) {
      query += ' AND ua.avg_sentiment >= ?';
      params.push(parseFloat(min_sentiment));
    }
    if (max_sentiment) {
      query += ' AND ua.avg_sentiment <= ?';
      params.push(parseFloat(max_sentiment));
    }

    // Tag filter (users who have this tag)
    if (tag) {
      query += ` AND ua.tag_counts LIKE ?`;
      params.push(`%"${tag}"%`);
    }

    // Sorting
    const validSortFields = ['total_messages', 'avg_sentiment', 'last_message_at', 'first_message_at'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'total_messages';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ua.${sortField} ${sortOrder}`;

    // Pagination
    const limitValue = Math.min(parseInt(limit) || 100, 1000);
    const offsetValue = parseInt(offset) || 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limitValue, offsetValue);

    const users = await db.query(query, params);

    // Parse tag counts
    const usersWithParsedTags = users.map(user => ({
      id: user.id,
      platform: user.platform,
      platform_user_id: user.platform_user_id,
      username: user.username,
      display_name: user.display_name,
      first_seen_at: user.first_seen_at,
      last_active_at: user.last_active_at,
      aggregate: user.tracker_id ? {
        tracker_id: user.tracker_id,
        total_messages: user.total_messages,
        avg_sentiment: user.avg_sentiment,
        tag_counts: JSON.parse(user.tag_counts || '{}'),
        first_message_at: user.first_message_at,
        last_message_at: user.last_message_at
      } : null
    }));

    res.json({
      users: usersWithParsedTags,
      total: usersWithParsedTags.length,
      limit: limitValue,
      offset: offsetValue
    });

  } catch (error) {
    logger.error(`Error fetching users: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/users/:userId
 * Get specific user details
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await db.queryOne(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    }

    // Get all tracker aggregates for this user
    const aggregates = await db.query(
      'SELECT * FROM user_aggregates WHERE user_id = ?',
      [userId]
    );

    res.json({
      ...user,
      aggregates: aggregates.map(agg => ({
        tracker_id: agg.tracker_id,
        total_messages: agg.total_messages,
        avg_sentiment: agg.avg_sentiment,
        tag_counts: JSON.parse(agg.tag_counts),
        first_message_at: agg.first_message_at,
        last_message_at: agg.last_message_at
      }))
    });

  } catch (error) {
    logger.error(`Error fetching user: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/users/:userId/sentiment-history
 * Get sentiment history for a user across trackers
 */
router.get('/:userId/sentiment-history', async (req, res) => {
  try {
    const { userId } = req.params;
    const { tracker_id } = req.query;

    // Check if user exists
    const user = await db.queryOne(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: 'User not found' });
    }

    let query = 'SELECT * FROM user_aggregates WHERE user_id = ?';
    const params = [userId];

    if (tracker_id) {
      query += ' AND tracker_id = ?';
      params.push(tracker_id);
    }

    query += ' ORDER BY last_message_at DESC';

    const history = await db.query(query, params);

    res.json({
      user_id: userId,
      history: history.map(h => ({
        tracker_id: h.tracker_id,
        total_messages: h.total_messages,
        avg_sentiment: h.avg_sentiment,
        tag_counts: JSON.parse(h.tag_counts),
        first_message_at: h.first_message_at,
        last_message_at: h.last_message_at
      }))
    });

  } catch (error) {
    logger.error(`Error fetching user sentiment history: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

/**
 * GET /api/users/top/active
 * Get most active users
 */
router.get('/top/active', async (req, res) => {
  try {
    const { tracker_id, limit } = req.query;
    const limitValue = Math.min(parseInt(limit) || 50, 100);

    let query = `
      SELECT u.*, ua.total_messages, ua.avg_sentiment, ua.tag_counts,
             ua.tracker_id, ua.last_message_at
      FROM users u
      JOIN user_aggregates ua ON u.id = ua.user_id
      WHERE 1=1
    `;
    const params = [];

    if (tracker_id) {
      query += ' AND ua.tracker_id = ?';
      params.push(tracker_id);
    }

    query += ' ORDER BY ua.total_messages DESC LIMIT ?';
    params.push(limitValue);

    const users = await db.query(query, params);

    res.json({
      users: users.map(u => ({
        id: u.id,
        platform: u.platform,
        username: u.username,
        display_name: u.display_name,
        total_messages: u.total_messages,
        avg_sentiment: u.avg_sentiment,
        tag_counts: JSON.parse(u.tag_counts || '{}'),
        last_message_at: u.last_message_at,
        tracker_id: u.tracker_id
      })),
      total: users.length
    });

  } catch (error) {
    logger.error(`Error fetching top active users: ${error.message}`);
    res.status(500).json({ error: 'InternalServerError', message: error.message });
  }
});

module.exports = router;
