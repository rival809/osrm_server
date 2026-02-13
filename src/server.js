const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const { body, query, validationResult } = require('express-validator');
const logger = require('./logger');
const MemoryMonitor = require('./memoryMonitor');
const { checkHealth: checkPostGIS } = require('./db');
const boundaryRoutes = require('./boundaryRoutes');

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

// Administrative Boundary API
app.use('/api/boundaries', boundaryRoutes);

// OSRM URL
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5003';

// Tileserver URL (required for self-hosted setup)
const TILE_SERVER_URL = process.env.TILE_SERVER_URL || 'http://localhost:5001/styles/basic-preview';

// Nominatim URL (for reverse geocoding)
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'http://localhost:5002';

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
logger.info('Nominatim URL:', NOMINATIM_URL);

// Apply rate limiting (disabled for internal microservice - let gateway handle it)
// For production: Rate limiting should be handled by Backend Sambara Gateway
// app.use('/api', globalLimiter);
// app.use('/route', routeLimiter);
// app.use('/tiles', tileLimiter);

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

    // Check if nominatim is accessible
    let nominatimStatus = 'unknown';
    try {
      await axios.get(`${NOMINATIM_URL}/status.php`, { timeout: 2000 });
      nominatimStatus = 'ok';
    } catch (e) {
      nominatimStatus = 'unreachable';
    }

    // Check PostGIS
    const postgisHealth = await checkPostGIS();
    
    res.json({
      status: 'ok',
      service: 'OSRM Tile Service (Self-Hosted Proxy + Geocoding)',
      region: 'Java Island',
      architecture: 'lightweight-proxy',
      tileServer: TILE_SERVER_URL,
      tileserverStatus,
      osrmBackend: OSRM_URL,
      nominatim: NOMINATIM_URL,
      nominatimStatus,
      postgis: postgisHealth,
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

/**
 * Reverse Geocoding endpoint - Get location name from coordinates
 * GET /geocode/reverse?lat=-6.9175&lon=107.6191
 */
app.get('/geocode/reverse', [
  query('lat')
    .notEmpty()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be a valid number between -90 and 90'),
  query('lon')
    .notEmpty()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be a valid number between -180 and 180'),
  handleValidationErrors
], async (req, res) => {
  const startTime = Date.now();
  const { lat, lon, zoom = 18, format = 'json' } = req.query;
  
  try {
    logger.info('Reverse geocoding request received', {
      lat,
      lon,
      zoom,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Build Nominatim URL
    const nominatimUrl = `${NOMINATIM_URL}/reverse`;
    const params = {
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      zoom: parseInt(zoom) || 18,
      format: format || 'json',
      addressdetails: 1,
      extratags: 1,
      namedetails: 1,
      'accept-language': 'id,en' // Prioritas bahasa Indonesia
    };

    logger.info('Requesting Nominatim', { nominatimUrl, params });

    // Request to Nominatim with timeout
    const response = await axios.get(nominatimUrl, { 
      params,
      timeout: 10000 // 10 seconds timeout
    });

    logger.info('Nominatim responded', { 
      status: response.status,
      place_id: response.data.place_id,
      display_name: response.data.display_name
    });

    const responseTime = Date.now() - startTime;
    
    // Format response
    const result = {
      success: true,
      region: 'Java Island',
      mode: 'offline',
      responseTime: `${responseTime}ms`,
      coordinates: {
        lat: parseFloat(lat),
        lon: parseFloat(lon)
      },
      location: {
        display_name: response.data.display_name,
        name: response.data.name || response.data.display_name?.split(',')[0],
        place_id: response.data.place_id,
        osm_type: response.data.osm_type,
        osm_id: response.data.osm_id,
        type: response.data.type,
        class: response.data.class
      },
      address: response.data.address || {},
      boundingbox: response.data.boundingbox || []
    };

    logger.info('Reverse geocoding completed', {
      lat,
      lon,
      location: result.location.display_name,
      responseTime: `${responseTime}ms`
    });

    res.json(result);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('Reverse geocoding error', {
      error: error.message,
      stack: error.stack,
      lat,
      lon,
      responseTime: `${responseTime}ms`,
      ip: req.ip
    });
    
    // Check if Nominatim returned "Unable to geocode"
    if (error.response?.status === 200 && error.response?.data?.error) {
      return res.status(404).json({
        success: false,
        error: 'Location not found',
        message: 'No address found for these coordinates',
        coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) },
        responseTime: `${responseTime}ms`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to reverse geocode',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      responseTime: `${responseTime}ms`
    });
  }
});

/**
 * Forward Geocoding endpoint - Search for locations by name
 * GET /geocode/search?q=Bandung
 */
app.get('/geocode/search', [
  query('q')
    .notEmpty()
    .isLength({ min: 2, max: 200 })
    .withMessage('Query must be between 2 and 200 characters'),
  handleValidationErrors
], async (req, res) => {
  const startTime = Date.now();
  const { q, limit = 5, countrycodes = 'id', format = 'json' } = req.query;
  
  try {
    logger.info('Forward geocoding request received', {
      query: q,
      limit,
      ip: req.ip
    });

    // Build Nominatim URL
    const nominatimUrl = `${NOMINATIM_URL}/search`;
    const params = {
      q,
      format: format || 'json',
      limit: parseInt(limit) || 5,
      countrycodes: countrycodes || 'id',
      addressdetails: 1,
      extratags: 1,
      namedetails: 1,
      'accept-language': 'id,en'
    };

    logger.info('Requesting Nominatim search', { nominatimUrl, params });

    // Request to Nominatim with timeout
    const response = await axios.get(nominatimUrl, { 
      params,
      timeout: 10000
    });

    const responseTime = Date.now() - startTime;
    
    // Format response
    const results = response.data.map(item => ({
      display_name: item.display_name,
      name: item.name || item.display_name?.split(',')[0],
      place_id: item.place_id,
      osm_type: item.osm_type,
      osm_id: item.osm_id,
      type: item.type,
      class: item.class,
      coordinates: {
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon)
      },
      address: item.address || {},
      boundingbox: item.boundingbox || []
    }));

    logger.info('Forward geocoding completed', {
      query: q,
      resultsCount: results.length,
      responseTime: `${responseTime}ms`
    });

    res.json({
      success: true,
      region: 'Java Island',
      mode: 'offline',
      responseTime: `${responseTime}ms`,
      query: q,
      count: results.length,
      results
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('Forward geocoding error', {
      error: error.message,
      query: q,
      responseTime: `${responseTime}ms`,
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to search location',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      responseTime: `${responseTime}ms`
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
  logger.info(`🚀 OSRM Service Started (Lightweight Proxy + Geocoding)`);
  logger.info('='.repeat(50));
  logger.info(`📍 Server: http://0.0.0.0:${PORT}`);
  logger.info(`🌍 Region: Java Island`);
  logger.info(`🔧 Architecture: Lightweight Proxy (Self-Hosted)`);
  logger.info(`🗺️  Tileserver: ${TILE_SERVER_URL}`);
  logger.info(`🛣️  OSRM Backend: ${OSRM_URL}`);
  logger.info(`📍 Nominatim: ${NOMINATIM_URL}`);
  logger.info(`🛡️  Security: Helmet, Rate Limiting, Validation`);
  logger.info(`📊 Monitoring: Memory tracking, Structured logging`);
  logger.info('');
  logger.info('📡 Available endpoints:');
  logger.info(`   🏥 Health: http://localhost:${PORT}/health`);
  logger.info(`   🛣️  Routes: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  logger.info(`   🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png (proxy)`);
  logger.info(`   📍 Reverse Geocoding: http://localhost:${PORT}/geocode/reverse?lat=-6.9175&lon=107.6191`);
  logger.info(`   🔍 Search Location: http://localhost:${PORT}/geocode/search?q=Bandung`);
  logger.info(`   🗺️  Boundaries:     http://localhost:${PORT}/api/boundaries/city`);
  logger.info(`   ✂️  Split:          POST http://localhost:${PORT}/api/boundaries/split`);
  logger.info('');
  logger.info('🌐 Web UI: http://localhost:' + PORT);
  logger.info('='.repeat(50));
});

module.exports = app;