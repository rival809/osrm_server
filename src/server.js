const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const { body, query, validationResult } = require('express-validator');
const { SphericalMercator } = require('@mapbox/sphericalmercator');
const TileCacheManager = require('./tile-cache');
const logger = require('./logger');
const {
  globalLimiter,
  routeLimiter,
  tileLimiter,
  cacheLimiter,
  preloadLimiter
} = require('./rateLimiter');
const MemoryMonitor = require('./memoryMonitor');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8080;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "unpkg.com"],
      scriptSrc: ["'self'", "unpkg.com"],
      imgSrc: ["'self'", "data:", "*.openstreetmap.org"],
      connectSrc: ["'self'"]
    }
  }
}));

// Compression middleware
app.use(compression());

// Enable CORS with production settings
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : true,
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// OSRM URL
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';

// Initialize SphericalMercator for proper tile calculations
const merc = new SphericalMercator({
  size: 256
});

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

// Initialize Tile Cache Manager
const cacheManager = new TileCacheManager({
  cacheDir: process.env.CACHE_DIR || './cache',
  cacheTTL: parseInt(process.env.TILE_CACHE_TTL) || 86400000, // 24 hours
  maxCacheSizeMB: parseInt(process.env.MAX_CACHE_SIZE_MB) || 1000, // 1GB
  userAgent: 'OSRM-Tile-Service/1.0 (Java Island Routing Service)',
  logger: logger // Pass logger to cache manager
});

// Configuration
const CACHE_MODE = process.env.CACHE_MODE || 'smart'; // 'smart', 'preload', 'proxy'
const PRELOAD_ENABLED = process.env.PRELOAD_ENABLED === 'true';

// Batas wilayah Java Island (full coverage)
const JAVA_ISLAND_BOUNDS = {
  minLon: 105.0,
  minLat: -8.8,
  maxLon: 114.0,
  maxLat: -5.9
};

// Apply global rate limiting to all routes except health
app.use('/api', globalLimiter);
app.use('/route', routeLimiter);
app.use('/tiles', tileLimiter);
app.use('/cache', cacheLimiter);

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
    const cacheStats = await cacheManager.getCacheStatistics();
    const memoryStats = memoryMonitor.getMemoryStats();
    
    res.json({
      status: 'ok',
      service: 'OSRM Tile Service (Full Local)',
      region: 'Java Island',
      mode: 'offline',
      cacheMode: CACHE_MODE,
      preloadEnabled: PRELOAD_ENABLED,
      memory: {
        current: memoryStats.current,
        percent: memoryStats.percent,
        status: memoryStats.percent > 90 ? 'critical' : memoryStats.percent > 80 ? 'warning' : 'ok'
      },
      cache: {
        totalTiles: cacheStats.totalTiles,
        totalSizeMB: cacheStats.totalSizeMB,
        zoomLevels: Object.keys(cacheStats.zoomLevels).length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'ok', // Still return OK for basic health
      service: 'OSRM Tile Service',
      region: 'Java Island',
      cacheMode: CACHE_MODE,
      cacheError: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Cache statistics endpoint
 */
app.get('/cache/stats', async (req, res) => {
  try {
    const stats = await cacheManager.getCacheStatistics();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Preload tiles endpoint
 * POST /cache/preload
 */
app.post('/cache/preload', async (req, res) => {
  try {
    const { zoomLevels = [10, 11, 12, 13], bounds = null } = req.body;
    
    // Validate zoom levels
    const validZooms = zoomLevels.filter(z => z >= 0 && z <= 18);
    if (validZooms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid zoom levels. Must be between 0-18'
      });
    }
    
    // Start direct preload process (don't wait for completion)
    const preloadPromise = cacheManager.preloadTilesDirectly(validZooms, bounds || JAVA_ISLAND_BOUNDS);
    
    // Calculate estimated tiles
    let estimatedTiles = 0;
    for (const zoom of validZooms) {
      const tiles = cacheManager.getTilesForBounds(bounds || JAVA_ISLAND_BOUNDS, zoom);
      estimatedTiles += tiles.length;
    }
    
    // Return immediately with process info
    res.json({
      success: true,
      message: 'Direct tile preload started (OSM → Cache)',
      method: 'direct-osm',
      mode: 'offline-ready',
      zoomLevels: validZooms,
      bounds: bounds || JAVA_ISLAND_BOUNDS,
      estimatedTiles: estimatedTiles,
      note: 'Tiles are downloaded directly from OSM servers and cached locally for offline use'
    });
    
    // Log results when complete
    preloadPromise.then(results => {
      console.log('✅ Direct preload completed:', results);
    }).catch(error => {
      console.error('❌ Direct preload failed:', error);
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Preload single tile endpoint
 * POST /cache/preload/single
 */
app.post('/cache/preload/single', async (req, res) => {
  try {
    const { z, x, y } = req.body;
    
    // Validate coordinates
    if (typeof z !== 'number' || typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid tile coordinates (z, x, y must be numbers)'
      });
    }
    
    if (z < 0 || z > 18) {
      return res.status(400).json({
        success: false,
        error: 'Invalid zoom level. Must be between 0-18'
      });
    }
    
    // Preload single tile directly
    const result = await cacheManager.preloadTileDirectly(z, x, y);
    
    res.json({
      success: result.success,
      tile: { z, x, y },
      source: result.source,
      message: result.message || result.error,
      method: 'direct-osm'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Manual cache management endpoint
 * POST /cache/clean
 */
app.post('/cache/clean', async (req, res) => {
  try {
    const { type = 'all' } = req.body;
    
    const result = await cacheManager.cleanCache(type);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Manual tile update endpoint - force refresh from OSM
 * POST /cache/update
 */
app.post('/cache/update', async (req, res) => {
  try {
    const { bounds, minZoom = 10, maxZoom = 15 } = req.body;
    
    if (!bounds) {
      return res.status(400).json({
        success: false,
        error: 'Bounds parameter required',
        example: {
          bounds: { minLat: -6.3, maxLat: -6.1, minLng: 106.7, maxLng: 106.9 },
          minZoom: 10,
          maxZoom: 15
        }
      });
    }
    
    console.log(`🔄 Manual tile update requested for bounds:`, bounds);
    
    // Run update asynchronously
    cacheManager.updateTiles(bounds, minZoom, maxZoom)
      .then(result => {
        console.log(`✅ Manual tile update completed: ${result.updated}/${result.total} tiles`);
      })
      .catch(error => {
        console.error('❌ Manual tile update failed:', error.message);
      });
    
    res.json({
      success: true,
      message: 'Manual tile update started',
      bounds: bounds,
      zoomRange: `${minZoom}-${maxZoom}`,
      note: 'Update is running in background. Check logs for progress.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
  try {
    const { start, end, alternatives = 'false', steps = 'true', geometries = 'geojson' } = req.query;
    
    logger.info('Route request received', {
      start, 
      end, 
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Parse coordinates
    const [startLon, startLat] = start.split(',').map(parseFloat);
    const [endLon, endLat] = end.split(',').map(parseFloat);

    // Validasi koordinat dalam batas Jawa Barat
    if (!isInWestJava(startLon, startLat) || !isInWestJava(endLon, endLat)) {
      return res.status(400).json({
        error: 'Koordinat harus berada di wilayah Jawa Barat',
        bounds: JAVA_ISLAND_BOUNDS
      });
    }

    // Build OSRM URL
    const osrmUrl = `${OSRM_URL}/route/v1/driving/${startLon},${startLat};${endLon},${endLat}`;
    const params = {
      alternatives: alternatives || 'false',
      steps: steps || 'true',
      geometries: geometries || 'geojson',
      overview: 'full'
    };

    // Request ke OSRM
    const response = await axios.get(osrmUrl, { params });

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
 * Tile endpoint - serve cached tiles or download from OSM
 * GET /tiles/:z/:x/:y.png
 */
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const zoom = parseInt(z);
    const tileX = parseInt(x);
    const tileY = parseInt(y);

    // Validasi zoom level
    if (zoom < 0 || zoom > 18) {
      return res.status(400).json({ error: 'Zoom level harus antara 0-18' });
    }

    // Calculate tile bounds
    const bounds = tileToBounds(tileX, tileY, zoom);

    // Cek apakah tile dalam batas Jawa Barat
    if (!isTileInJavaIsland(bounds)) {
      // Return empty tile jika di luar Jawa Barat
      const emptyTile = await createEmptyTile();
      res.set('Content-Type', 'image/png');
      res.set('X-Region', 'outside');
      return res.send(emptyTile);
    }

    let tile;
    let cacheStatus = 'MISS';
    
    try {
      // Try to get from cache or download
      const result = await cacheManager.getTile(zoom, tileX, tileY);
      tile = result.tile;
      cacheStatus = result.source === 'cache' ? 'HIT' : 'MISS';
    } catch (error) {
      console.error(`Error getting tile ${zoom}/${tileX}/${tileY}:`, error.message);
      
      // Fallback to empty tile
      const emptyTile = await createEmptyTile();
      res.set('Content-Type', 'image/png');
      res.set('X-Cache', 'ERROR');
      res.set('X-Error', error.message);
      return res.send(emptyTile);
    }

    // Serve tile
    res.set('Content-Type', 'image/png');
    res.set('X-Cache', cacheStatus);
    res.set('X-Region', 'west-java');
    res.send(tile);

  } catch (error) {
    console.error('Tile serving error:', error.message);
    
    try {
      const emptyTile = await createEmptyTile();
      res.set('Content-Type', 'image/png');
      res.set('X-Error', 'SERVE_ERROR');
      res.send(emptyTile);
    } catch (e) {
      res.status(500).json({
        error: 'Gagal melayani tile',
        message: error.message
      });
    }
  }
});


/**
 * Helper functions
 */

// Check if tile intersects Java Island
function isTileInJavaIsland(bounds) {
  return !(bounds.maxLon < JAVA_ISLAND_BOUNDS.minLon ||
           bounds.minLon > JAVA_ISLAND_BOUNDS.maxLon ||
           bounds.maxLat < JAVA_ISLAND_BOUNDS.minLat ||
           bounds.minLat > JAVA_ISLAND_BOUNDS.maxLat);
}

// Convert tile coordinates to lat/lon bounds
function tileToBounds(x, y, z) {
  const bbox = merc.bbox(x, y, z, false, 'WGS84');
  
  return {
    minLon: bbox[0],
    minLat: bbox[1], 
    maxLon: bbox[2],
    maxLat: bbox[3]
  };
}

// Create empty/transparent tile
async function createEmptyTile() {
  try {
    // Create a simple transparent PNG
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    
    // Fill with light gray color to indicate "no data"
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 256, 256);
    
    // Add text
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Outside', 128, 120);
    ctx.fillText('Java Island', 128, 140);
    
    return canvas.toBuffer('image/png');
  } catch (error) {
    // Fallback: return a minimal PNG buffer
    console.warn('Canvas not available, using fallback empty tile');
    return Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0x1D, 0x01, 0x01, 0x00, 0x00, 0xFF,
      0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
  }
}

// Start preload if enabled
if (PRELOAD_ENABLED) {
  console.log('🔄 Preload is enabled, starting background tile preload...');
  
  // Start preload after server starts
  setTimeout(async () => {
    try {
      const defaultZooms = [10, 11, 12];
      console.log(`🚀 Starting automatic preload for zoom levels: ${defaultZooms.join(', ')}`);
      
      const results = await cacheManager.preloadTiles(defaultZooms, JAVA_ISLAND_BOUNDS);
      console.log('✅ Automatic preload completed:', {
        totalTiles: results.totalTiles,
        downloadedTiles: results.downloadedTiles,
        cachedTiles: results.cachedTiles,
        failedTiles: results.failedTiles,
        durationMinutes: Math.round(results.duration / 60000)
      });
    } catch (error) {
      console.error('❌ Automatic preload failed:', error.message);
    }
  }, 5000); // Wait 5 seconds after server start
}

// Periodic cache cleanup (every 6 hours)
setInterval(async () => {
  try {
    console.log('🧹 Running periodic cache cleanup...');
    const cleaned = await cacheManager.cleanCache();
    if (cleaned > 0) {
      console.log(`✅ Cleaned ${cleaned} old cache entries`);
    }
  } catch (error) {
    console.error('❌ Cache cleanup failed:', error.message);
  }
}, 6 * 60 * 60 * 1000); // 6 hours

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
  logger.info(`🚀 OSRM Tile Service Started (Production Ready)`);
  logger.info('='.repeat(50));
  logger.info(`📍 Server: http://0.0.0.0:${PORT}`);
  logger.info(`🌍 Region: Java Island (Full Coverage)`);
  logger.info(`🔧 Mode: Full Local (No External Dependencies)`);
  logger.info(`💾 Cache: Persistent file-based storage`);
  logger.info(`🛡️  Security: Helmet, Rate Limiting, Validation`);
  logger.info(`📊 Monitoring: Memory tracking, Structured logging`);
  logger.info(`📁 Cache Directory: ${cacheManager.cacheDir}`);
  logger.info('');
  logger.info('📡 Available endpoints:');
  logger.info(`   🏥 Health: http://localhost:${PORT}/health`);
  logger.info(`   🛣️  Routes: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  logger.info(`   🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png`);
  logger.info(`   📊 Cache Stats: http://localhost:${PORT}/cache/stats`);
  logger.info(`   🔄 Preload: POST http://localhost:${PORT}/cache/preload`);
  logger.info('');
  logger.info('🌐 Web UI: http://localhost:' + PORT);
  logger.info('='.repeat(50));
});

module.exports = app;