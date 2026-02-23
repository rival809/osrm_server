/**
 * Admin Authentication Middleware
 *
 * Uses a simple Bearer token stored in the ADMIN_TOKEN environment variable.
 * Set ADMIN_TOKEN in your .env or docker-compose environment section.
 *
 * Login flow:
 *   POST /api/admin/login  { "password": "<token>" }  → returns { token }
 *   All subsequent requests carry: Authorization: Bearer <token>
 */

const express = require('express');
const logger  = require('./logger');

const router = express.Router();

// Read token from env, fallback for dev only – must be changed in production
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  logger.warn('[AdminAuth] ADMIN_TOKEN is not set in environment variables! Admin API is disabled.');
}

// ─── Middleware: verify Bearer token ────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      success: false,
      error: 'Admin access is not configured. Set ADMIN_TOKEN environment variable.',
    });
  }

  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token || token !== ADMIN_TOKEN) {
    logger.warn('[AdminAuth] Unauthorized access attempt', {
      ip:     req.ip,
      ua:     req.headers['user-agent'],
      path:   req.originalUrl,
    });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  next();
}

// ─── POST /api/admin/login ───────────────────────────────────────────────────
// Body: { "password": "your-admin-token" }
// Returns: { success, token }

router.post('/login', (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      success: false,
      error: 'Admin access is not configured on this server.',
    });
  }

  const { password } = req.body || {};
  if (!password || password !== ADMIN_TOKEN) {
    logger.warn('[AdminAuth] Failed login attempt', { ip: req.ip });
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }

  logger.info('[AdminAuth] Successful login', { ip: req.ip });
  res.json({ success: true, token: ADMIN_TOKEN });
});

// ─── GET /api/admin/verify ───────────────────────────────────────────────────
// Quick token check used by the frontend on page load.

router.get('/verify', requireAuth, (_req, res) => {
  res.json({ success: true, message: 'Token is valid' });
});

module.exports = { router, requireAuth };
