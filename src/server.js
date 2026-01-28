const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const { body, query, validationResult } = require('express-validator');
const logger = require('./logger');
const {
  globalLimiter,
  routeLimiter,
  tileLimiter
} = require('./rateLimiter');
const MemoryMonitor = require('./memoryMonitor');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 81;

// Trust proxy to handle X-Forwarded-For header from nginx
app.set('trust proxy', true);

// Security middleware (CSP disabled for external resources)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Compression middleware
app.use(compression());

// Enable CORS - Allow all origins for public API access
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'DNT',
    'User-Agent',
    'X-Requested-With',
    'If-Modified-Since',
    'Cache-Control',
    'Range'
  ],
  exposedHeaders: ['X-Cache-Status', 'Content-Length', 'Content-Range'],
  optionsSuccessStatus: 204,
  maxAge: 1728000 // 20 days
}));

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// OSRM URL
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';

// Tileserver URL (required for self-hosted setup)
const TILE_SERVER_URL = process.env.TILE_SERVER_URL || 'http://localhost:8000/styles/basic-preview';

// Initialize Memory Monitor
const memoryMonitor = new MemoryMonitor({
  maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB) || 10000, // 10GB
  warningThresholdPercent: 80,
  criticalThresholdPercent: 90,
  interval: 30000 // 30 seconds
});

// Start memory monitoring in production
if (process.env.NODE_ENV === 'production') {
  memoryMonitor.start();
  logger.info('Memory monitoring started');
}

logger.info('Tileserver URL:', TILE_SERVER_URL);

// Apply global rate limiting to all routes except health
app.use('/api', globalLimiter);
app.use('/route', routeLimiter);
app.use('/tiles', tileLimiter);

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors:', { errors: errors.array(), ip: req.ip });
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * Health check endpoint (no rate limiting)
 */
app.get('/health', async (req, res) => {
  try {
    const memoryStats = memoryMonitor.getMemoryStats();
    
    // Check if tileserver is accessible
    let tileserverStatus = 'unknown';
    try {
      await axios.get(TILE_SERVER_URL, { timeout: 2000 });
      tileserverStatus = 'ok';
    } catch (e) {
      tileserverStatus = 'unreachable';
    }
    
    res.json({
      status: 'ok',
      service: 'OSRM Tile Service (Self-Hosted Proxy)',
      region: 'Java Island',
      architecture: 'lightweight-proxy',
      tileServer: TILE_SERVER_URL,
      tileserverStatus,
      osrmBackend: OSRM_URL,
      memory: {
        current: memoryStats.current,
        percent: memoryStats.percent,
        status: memoryStats.percent > 90 ? 'critical' : memoryStats.percent > 80 ? 'warning' : 'ok'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'ok',
      service: 'OSRM Tile Service',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cache endpoints removed - using direct tileserver proxy

/**
 * Routing endpoint with validation - proxy ke OSRM backend
 * GET /route?start=lon,lat&end=lon,lat
 */
app.get('/route', [
  query('start')
    .notEmpty()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('Start coordinates must be in format: lon,lat'),
  query('end')
    .notEmpty()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('End coordinates must be in format: lon,lat'),
  handleValidationErrors
], async (req, res) => {
  const startTime = Date.now();
  const { start, end, alternatives = 'false', steps = 'true', geometries = 'geojson' } = req.query;
  
  try {
    logger.info('Route request received', {
      start, 
      end, 
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Parse coordinates
    const [startLon, startLat] = start.split(',').map(parseFloat);
    const [endLon, endLat] = end.split(',').map(parseFloat);

    // Validasi koordinat dalam batas Jawa (disabled - function not defined)
    // if (!isInWestJava(startLon, startLat) || !isInWestJava(endLon, endLat)) {
    //   return res.status(400).json({
    //     error: 'Koordinat harus berada di wilayah Jawa Barat',
    //     bounds: JAVA_ISLAND_BOUNDS
    //   });
    // }

    // Build OSRM URL
    const osrmUrl = `${OSRM_URL}/route/v1/driving/${startLon},${startLat};${endLon},${endLat}`;
    const params = {
      alternatives: alternatives || 'false',
      steps: steps || 'true',
      geometries: geometries || 'geojson',
      overview: 'full'
    };

    logger.info('Requesting OSRM backend', { osrmUrl, params });

    // Request ke OSRM with timeout
    const response = await axios.get(osrmUrl, { 
      params,
      timeout: 30000 // 30 seconds timeout
    });

    logger.info('OSRM backend responded', { 
      status: response.status,
      dataSize: JSON.stringify(response.data).length 
    });

    const responseTime = Date.now() - startTime;
    
    logger.info('Route request completed', {
      start,
      end,
      responseTime: `${responseTime}ms`,
      distance: response.data.routes?.[0]?.distance,
      duration: response.data.routes?.[0]?.duration
    });

    res.json({
      success: true,
      region: 'Java Island',
      mode: 'offline',
      responseTime: `${responseTime}ms`,
      data: response.data
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    // Debug: print full error
    console.error('ROUTING ERROR DETAIL:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    logger.error('Routing error', {
      error: error.message,
      stack: error.stack,
      start,
      end,
      responseTime: `${responseTime}ms`,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to calculate route',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      responseTime: `${responseTime}ms`
    });
  }
});

/**
 * Tile endpoint - lightweight proxy to tileserver
 * GET /tiles/:z/:x/:y.png
 */
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const zoom = parseInt(z);

    // Validasi zoom level
    if (zoom < 0 || zoom > 18) {
      return res.status(400).json({ error: 'Zoom level must be between 0-18' });
    }

    // Proxy request to tileserver
    const tileUrl = `${TILE_SERVER_URL}/${z}/${x}/${y}.png`;
    
    logger.debug(`Proxying tile request: ${z}/${x}/${y}`);
    
    const response = await axios.get(tileUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'OSRM-Tile-Service/2.0'
      }
    });

    // Forward tile to client
    res.set('Content-Type', 'image/png');
    res.set('X-Tile-Source', 'tileserver-proxy');
    res.set('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.send(Buffer.from(response.data));

  } catch (error) {
    logger.error(`Tile proxy error for ${req.params.z}/${req.params.x}/${req.params.y}:`, error.message);
    
    // Return simple error response
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch tile from tileserver',
      message: error.message,
      tile: `${req.params.z}/${req.params.x}/${req.params.y}`
    });
  }
});


// No helper functions needed for lightweight proxy mode

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  memoryMonitor.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  memoryMonitor.stop();
  process.exit(0);
});

/**
 * Start server
 */
app.listen(PORT, '0.0.0.0', () => {
  logger.info('='.repeat(50));
  logger.info(`🚀 OSRM Service Started (Lightweight Proxy)`);
  logger.info('='.repeat(50));
  logger.info(`📍 Server: http://0.0.0.0:${PORT}`);
  logger.info(`🌍 Region: Java Island`);
  logger.info(`🔧 Architecture: Lightweight Proxy (Self-Hosted)`);
  logger.info(`🗺️  Tileserver: ${TILE_SERVER_URL}`);
  logger.info(`🛣️  OSRM Backend: ${OSRM_URL}`);
  logger.info(`🛡️  Security: Helmet, Rate Limiting, Validation`);
  logger.info(`📊 Monitoring: Memory tracking, Structured logging`);
  logger.info('');
  logger.info('📡 Available endpoints:');
  logger.info(`   🏥 Health: http://localhost:${PORT}/health`);
  logger.info(`   🛣️  Routes: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  logger.info(`   🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png (proxy)`);
  logger.info('');
  logger.info('🌐 Web UI: http://localhost:' + PORT);
  logger.info('='.repeat(50));
});

module.exports = app;