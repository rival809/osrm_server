/**
 * Rate Limiting Configuration
 * Production-ready rate limiting for different endpoints
 */

const rateLimit = require('express-rate-limit');
const logger = require('./logger');

// Memory store for rate limiting (consider Redis for production cluster)
const MemoryStore = require('express-rate-limit').MemoryStore;

// Dynamic rate limit based on server load
const getDynamicLimit = () => {
  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.rss / (12 * 1024 * 1024 * 1024)) * 100; // Assuming 12GB total
  
  if (memPercent < 50) return { route: 100, tile: 600, global: 500 }; // Normal load
  if (memPercent < 70) return { route: 60, tile: 400, global: 300 };  // High load  
  if (memPercent < 85) return { route: 30, tile: 200, global: 150 };  // Critical load
  return { route: 10, tile: 50, global: 75 }; // Emergency
};

// Rate limit message handler
const rateLimitMessage = (type) => ({
  error: 'Rate limit exceeded',
  type: type,
  message: `Too many ${type} requests. Please try again later.`,
  retryAfter: '60 seconds',
  timestamp: new Date().toISOString()
});

// Global API rate limit
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: () => getDynamicLimit().global,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  message: rateLimitMessage('API'),
  // Trust proxy to handle X-Forwarded-For header from nginx
  trustProxy: true,
  // Skip failed requests (don't count them towards rate limit)
  skipFailedRequests: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP ${req.ip} on ${req.path}`);
    res.status(429).json(rateLimitMessage('API'));
  }
});

// Routing endpoint rate limit (more expensive operations)
const routeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute  
  max: () => getDynamicLimit().route,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  trustProxy: true,
  message: rateLimitMessage('routing'),
  handler: (req, res) => {
    logger.warn(`Route rate limit exceeded for IP ${req.ip}`);
    res.status(429).json(rateLimitMessage('routing'));
  }
});

// Tile endpoint rate limit (cached, allow more)
const tileLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: () => getDynamicLimit().tile,
  standardHeaders: true, 
  legacyHeaders: false,
  store: new MemoryStore(),
  trustProxy: true,
  message: rateLimitMessage('tile'),
  handler: (req, res) => {
    logger.warn(`Tile rate limit exceeded for IP ${req.ip}`);
    res.status(429).json(rateLimitMessage('tile'));
  }
});

// Cache management rate limit (very restrictive)
const cacheLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Very limited
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  trustProxy: true,
  message: rateLimitMessage('cache management'),
  handler: (req, res) => {
    logger.warn(`Cache management rate limit exceeded for IP ${req.ip}`);
    res.status(429).json(rateLimitMessage('cache management'));
  }
});

// Preload rate limit (extremely restrictive)
const preloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1, // Only 1 preload per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  store: new MemoryStore(),
  trustProxy: true,
  message: rateLimitMessage('preload'),
  handler: (req, res) => {
    logger.warn(`Preload rate limit exceeded for IP ${req.ip}`);
    res.status(429).json(rateLimitMessage('preload'));
  }
});

module.exports = {
  globalLimiter,
  routeLimiter,
  tileLimiter,
  cacheLimiter,
  preloadLimiter,
  getDynamicLimit
};