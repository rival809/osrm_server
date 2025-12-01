const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { SphericalMercator } = require('@mapbox/sphericalmercator');
const TileCacheManager = require('./tile-cache');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static('public'));

// OSRM URL
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';

// Initialize SphericalMercator for proper tile calculations
const merc = new SphericalMercator({
  size: 256
});

// Initialize Tile Cache Manager
const cacheManager = new TileCacheManager({
  cacheDir: process.env.CACHE_DIR || './cache',
  cacheTTL: parseInt(process.env.TILE_CACHE_TTL) || 86400000, // 24 hours
  maxCacheSizeMB: parseInt(process.env.MAX_CACHE_SIZE_MB) || 1000, // 1GB
  userAgent: 'OSRM-Tile-Service/1.0 (West Java Routing Service)'
});

// Configuration
const CACHE_MODE = process.env.CACHE_MODE || 'smart'; // 'smart', 'preload', 'proxy'
const PRELOAD_ENABLED = process.env.PRELOAD_ENABLED === 'true';

// Batas wilayah Jawa Barat (approximate)
const WEST_JAVA_BOUNDS = {
  minLon: 104.5,
  minLat: -7.8,
  maxLon: 108.8,
  maxLat: -5.8
};

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    const cacheStats = await cacheManager.getCacheStatistics();
    
    res.json({
      status: 'ok',
      service: 'OSRM Tile Service',
      region: 'West Java (Jawa Barat)',
      cacheMode: CACHE_MODE,
      preloadEnabled: PRELOAD_ENABLED,
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
      region: 'West Java (Jawa Barat)',
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
    const preloadPromise = cacheManager.preloadTilesDirectly(validZooms, bounds || WEST_JAVA_BOUNDS);
    
    // Calculate estimated tiles
    let estimatedTiles = 0;
    for (const zoom of validZooms) {
      const tiles = cacheManager.getTilesForBounds(bounds || WEST_JAVA_BOUNDS, zoom);
      estimatedTiles += tiles.length;
    }
    
    // Return immediately with process info
    res.json({
      success: true,
      message: 'Direct tile preload started (OSM → Cache)',
      method: 'direct-osm',
      zoomLevels: validZooms,
      bounds: bounds || WEST_JAVA_BOUNDS,
      estimatedTiles: estimatedTiles,
      note: 'Tiles are downloaded directly from OSM servers and cached locally'
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
 * Routing endpoint - proxy ke OSRM backend
 * GET /route?start=lon,lat&end=lon,lat
 */
app.get('/route', async (req, res) => {
  try {
    const { start, end, alternatives = 'false', steps = 'true', geometries = 'geojson' } = req.query;

    if (!start || !end) {
      return res.status(400).json({ 
        error: 'Parameter start dan end diperlukan',
        example: '/route?start=107.6191,-6.9175&end=107.6098,-6.9145'
      });
    }

    // Parse coordinates
    const [startLon, startLat] = start.split(',').map(parseFloat);
    const [endLon, endLat] = end.split(',').map(parseFloat);

    // Validasi koordinat dalam batas Jawa Barat
    if (!isInWestJava(startLon, startLat) || !isInWestJava(endLon, endLat)) {
      return res.status(400).json({
        error: 'Koordinat harus berada di wilayah Jawa Barat',
        bounds: WEST_JAVA_BOUNDS
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

    res.json({
      success: true,
      region: 'West Java',
      data: response.data
    });

  } catch (error) {
    console.error('Routing error:', error.message);
    res.status(500).json({
      error: 'Gagal mendapatkan rute',
      message: error.message
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
    if (!isTileInWestJava(bounds)) {
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
 * Geocoding endpoint - search via Nominatim
 * GET /geocode?q=query
 */
app.get('/geocode', async (req, res) => {
  try {
    const { q: query, limit = 5 } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Parameter q (query) diperlukan',
        example: '/geocode?q=Bandung'
      });
    }

    // Search via Nominatim with West Java bounds
    const nominatimUrl = 'https://nominatim.openstreetmap.org/search';
    const params = {
      q: query,
      format: 'json',
      limit: limit,
      bounded: 1,
      viewbox: `${WEST_JAVA_BOUNDS.minLon},${WEST_JAVA_BOUNDS.maxLat},${WEST_JAVA_BOUNDS.maxLon},${WEST_JAVA_BOUNDS.minLat}`,
      addressdetails: 1,
      extratags: 1,
      namedetails: 1
    };

    const response = await axios.get(nominatimUrl, { 
      params,
      headers: {
        'User-Agent': 'OSRM-Tile-Service/1.0'
      }
    });

    // Filter results to West Java only
    const filteredResults = response.data.filter(place => {
      const lon = parseFloat(place.lon);
      const lat = parseFloat(place.lat);
      return isInWestJava(lon, lat);
    });

    res.json({
      success: true,
      query: query,
      region: 'West Java',
      count: filteredResults.length,
      results: filteredResults
    });

  } catch (error) {
    console.error('Geocoding error:', error.message);
    res.status(500).json({
      error: 'Gagal melakukan geocoding',
      message: error.message
    });
  }
});

/**
 * Helper functions
 */

// Check if coordinates are in West Java bounds
function isInWestJava(lon, lat) {
  return lon >= WEST_JAVA_BOUNDS.minLon && 
         lon <= WEST_JAVA_BOUNDS.maxLon &&
         lat >= WEST_JAVA_BOUNDS.minLat && 
         lat <= WEST_JAVA_BOUNDS.maxLat;
}

// Check if tile intersects West Java
function isTileInWestJava(bounds) {
  return !(bounds.maxLon < WEST_JAVA_BOUNDS.minLon ||
           bounds.minLon > WEST_JAVA_BOUNDS.maxLon ||
           bounds.maxLat < WEST_JAVA_BOUNDS.minLat ||
           bounds.minLat > WEST_JAVA_BOUNDS.maxLat);
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
    ctx.fillText('West Java', 128, 140);
    
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
      
      const results = await cacheManager.preloadTiles(defaultZooms, WEST_JAVA_BOUNDS);
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

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 OSRM Tile Service Started');
  console.log('='.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🗺️  Region: West Java`);
  console.log(`💾 Cache Mode: ${CACHE_MODE}`);
  console.log(`🔄 Preload Enabled: ${PRELOAD_ENABLED}`);
  console.log(`📁 Cache Directory: ${cacheManager.cacheDir}`);
  console.log('');
  console.log('📡 Endpoints:');
  console.log(`   🏥 Health: http://localhost:${PORT}/health`);
  console.log(`   🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png`);
  console.log(`   🛣️  Routes: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  console.log(`   🔍 Geocode: http://localhost:${PORT}/geocode?q=query`);
  console.log(`   📊 Cache Stats: http://localhost:${PORT}/cache/stats`);
  console.log(`   🔄 Preload: POST http://localhost:${PORT}/cache/preload`);
  console.log('');
  console.log('🌐 Web UI: http://localhost:' + PORT);
  console.log('='.repeat(50));
});

module.exports = app;