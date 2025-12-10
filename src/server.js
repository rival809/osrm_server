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
logger.info('Initializing Tile Cache Manager...');
const cacheManager = new TileCacheManager({
  cacheDir: process.env.CACHE_DIR || './cache',
  cacheTTL: parseInt(process.env.TILE_CACHE_TTL) || 86400000, // 24 hours
  maxCacheSizeMB: parseInt(process.env.MAX_CACHE_SIZE_MB) || 1000, // 1GB
  userAgent: 'OSRM-Tile-Service/1.0 (Java Island Routing Service)',
  logger: logger // Pass logger to cache manager
});
logger.info('Tile Cache Manager initialized');

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

// Note: Cache management endpoints (preload, clean, update) have been removed
// Use server-side scripts for cache management:
// - Linux: ./CACHE-MANAGER.sh
// - Windows: .\CACHE-MANAGER.ps1

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
 * Tile endpoint - serve cached tiles or download from OSM
 * GET /tiles/:z/:x/:y.png
 */
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const zoom = parseInt(z);
    const tileX = parseInt(x);
    const tileY = parseInt(y);
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';

    // Validasi zoom level
    if (zoom < 0 || zoom > 18) {
      return res.status(400).json({ error: 'Zoom level harus antara 0-18' });
    }

    // Calculate tile bounds for logging only
    const bounds = tileToBounds(tileX, tileY, zoom);
    
    // Debug log for troubleshooting
    if (zoom >= 10 && zoom <= 13) {
      logger.debug(`Tile request ${zoom}/${tileX}/${tileY} bounds: ${JSON.stringify(bounds)}`);
    }

    let tile;
    let cacheStatus = 'MISS';
    let tileSource = 'unknown';
    
    if (forceRefresh) {
      logger.info(`Force refresh requested for tile ${zoom}/${tileX}/${tileY}`);
    }
    
    try {
      // Try to get from cache or download (skip cache if force refresh)
      const result = await cacheManager.getTile(zoom, tileX, tileY, forceRefresh);
      tile = result.tile;
      tileSource = result.source;
      cacheStatus = result.source === 'cache' ? 'HIT' : 'MISS';
      
      logger.debug(`Tile ${zoom}/${tileX}/${tileY} served from ${tileSource}`);
      
      // VALIDASI FINAL: Cek apakah tile yang akan dikirim adalah "Outside" tile
      // Ini adalah safety net untuk mencegah tile corrupt ter-serve
      if (tile && tile.length < 1000) {
        const tileStr = tile.toString('utf8', 0, Math.min(500, tile.length));
        if (tileStr.includes('Outside') || tileStr.includes('Java Island')) {
          logger.warn(`DETECTED: Tile ${zoom}/${tileX}/${tileY} contains "Outside" text (${tile.length} bytes), forcing re-download...`);
          
          // Force delete dari cache
          await cacheManager.deleteTile(zoom, tileX, tileY);
          
          // Download ulang TANPA cek cache
          const retryResult = await cacheManager.getTile(zoom, tileX, tileY, true);
          tile = retryResult.tile;
          tileSource = retryResult.source + '-revalidated';
          cacheStatus = 'REVALIDATED';
          
          logger.info(`Tile ${zoom}/${tileX}/${tileY} re-downloaded successfully (${tile.length} bytes)`);
        }
      }
    } catch (error) {
      logger.error(`Error getting tile ${zoom}/${tileX}/${tileY}:`, error.message);
      
      // Fallback to error tile
      const errorTile = await createErrorTile();
      res.set('Content-Type', 'image/png');
      res.set('X-Cache', 'ERROR');
      res.set('X-Error', error.message);
      return res.send(errorTile);
    }

    // Serve tile
    res.set('Content-Type', 'image/png');
    res.set('X-Cache', cacheStatus);
    res.set('X-Tile-Source', tileSource);
    res.set('X-Region', 'west-java');
    res.send(tile);

  } catch (error) {
    logger.error(`Tile serving error for ${req.params.z}/${req.params.x}/${req.params.y}:`, error.message, error.stack);
    
    try {
      const errorTile = await createErrorTile();
      res.set('Content-Type', 'image/png');
      res.set('X-Cache', 'ERROR');
      res.set('X-Error', error.message || 'SERVE_ERROR');
      res.set('X-Error-Stack', error.stack ? error.stack.split('\n')[0] : 'N/A');
      res.send(errorTile);
    } catch (e) {
      logger.error('Failed to create error tile:', e);
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

// Check if tile intersects Java Island (overlap check, not strict containment)
function isTileInJavaIsland(bounds) {
  // Tile overlaps with Java if:
  // - Tile's west edge is west of Java's east edge AND
  // - Tile's east edge is east of Java's west edge AND
  // - Tile's south edge is south of Java's north edge AND
  // - Tile's north edge is north of Java's south edge
  const overlapsLon = bounds.minLon < JAVA_ISLAND_BOUNDS.maxLon && 
                      bounds.maxLon > JAVA_ISLAND_BOUNDS.minLon;
  const overlapsLat = bounds.minLat < JAVA_ISLAND_BOUNDS.maxLat && 
                      bounds.maxLat > JAVA_ISLAND_BOUNDS.minLat;
  
  return overlapsLon && overlapsLat;
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

// Create empty tile for outside Java Island
async function createEmptyTile() {
  try {
    // Create a simple transparent PNG with unique marker
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    
    // Fill with light gray color to indicate "no data"
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 256, 256);
    
    // Add visible marker at bottom right corner (1x1 pixel with specific color)
    // RGB(255, 0, 255) = Magenta marker - invisible to eye but detectable
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(255, 255, 1, 1);
    
    // Add text
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Outside', 128, 120);
    ctx.fillText('Java Island', 128, 140);
    
    return canvas.toBuffer('image/png');
  } catch (error) {
    // Fallback: return a minimal PNG buffer (103 bytes - easy to detect by size)
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

// Create error tile for failed load
async function createErrorTile() {
  try {
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    
    // Fill with light red color to indicate error
    ctx.fillStyle = '#ffe0e0';
    ctx.fillRect(0, 0, 256, 256);
    
    // Add text
    ctx.fillStyle = '#cc0000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gagal', 128, 120);
    ctx.fillText('Memuat Peta', 128, 140);
    
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