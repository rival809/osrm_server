const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');
const { Pool } = require('pg');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static('public'));

// Cache untuk tiles (TTL 1 jam)
const tileCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://osm:osmpassword@localhost:5432/osm'
});

// OSRM URL
const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';

// Batas wilayah Jawa Barat (approximate)
const WEST_JAVA_BOUNDS = {
  minLon: 104.5,
  minLat: -7.8,
  maxLon: 108.8,
  maxLat: -5.8
};

// Tile rendering mode
const TILE_MODE = process.env.TILE_MODE || 'proxy'; // 'proxy' or 'render'

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OSRM Tile Service',
    region: 'West Java (Jawa Barat)',
    tileMode: TILE_MODE,
    timestamp: new Date().toISOString()
  });
});

/**
 * Routing endpoint - proxy ke OSRM backend
 * GET /route?start=lon,lat&end=lon,lat
 */
app.get('/route', async (req, res) => {
  try {
    const { start, end, alternatives, steps, geometries } = req.query;
    
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
 * Tile endpoint - serve tiles (proxy atau render)
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

    // Cache key
    const cacheKey = `tile_${z}_${x}_${y}`;
    
    // Cek cache
    const cachedTile = tileCache.get(cacheKey);
    if (cachedTile) {
      res.set('Content-Type', 'image/png');
      res.set('X-Cache', 'HIT');
      return res.send(cachedTile);
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
    
    if (TILE_MODE === 'render') {
      // Render dari database
      tile = await renderTileFromDB(bounds, zoom);
    } else {
      // Proxy dari OSM tile server
      tile = await proxyTileFromOSM(zoom, tileX, tileY);
    }

    // Simpan ke cache
    tileCache.set(cacheKey, tile);

    res.set('Content-Type', 'image/png');
    res.set('X-Cache', 'MISS');
    res.set('X-Region', 'west-java');
    res.send(tile);

  } catch (error) {
    console.error('Tile rendering error:', error.message);
    
    // Return empty tile on error
    try {
      const emptyTile = await createEmptyTile();
      res.set('Content-Type', 'image/png');
      res.send(emptyTile);
    } catch (e) {
      res.status(500).json({
        error: 'Gagal merender tile',
        message: error.message
      });
    }
  }
});

/**
 * Helper: Check if coordinates are in West Java bounds
 */
function isInWestJava(lon, lat) {
  return lon >= WEST_JAVA_BOUNDS.minLon && 
         lon <= WEST_JAVA_BOUNDS.maxLon &&
         lat >= WEST_JAVA_BOUNDS.minLat && 
         lat <= WEST_JAVA_BOUNDS.maxLat;
}

/**
 * Helper: Check if tile intersects West Java
 */
function isTileInWestJava(bounds) {
  return !(bounds.maxLon < WEST_JAVA_BOUNDS.minLon ||
           bounds.minLon > WEST_JAVA_BOUNDS.maxLon ||
           bounds.maxLat < WEST_JAVA_BOUNDS.minLat ||
           bounds.minLat > WEST_JAVA_BOUNDS.maxLat);
}

/**
 * Helper: Convert tile coordinates to lat/lon bounds
 */
function tileToBounds(x, y, z) {
  const n = Math.pow(2, z);
  const lonMin = (x / n) * 360 - 180;
  const lonMax = ((x + 1) / n) * 360 - 180;
  const latMin = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  const latMax = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  
  return {
    minLon: lonMin,
    minLat: latMin,
    maxLon: lonMax,
    maxLat: latMax
  };
}

/**
 * Helper: Proxy tile from OpenStreetMap
 */
async function proxyTileFromOSM(z, x, y) {
  const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  
  const response = await axios.get(tileUrl, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'OSRM-Tile-Service/1.0'
    },
    timeout: 5000
  });

  return Buffer.from(response.data);
}

/**
 * Helper: Render tile from database (FUTURE: implement with proper tile renderer)
 */
async function renderTileFromDB(bounds, zoom) {
  console.log('Rendering from database is not yet implemented in Windows');
  console.log('Fallback to proxy mode or deploy to Linux/Docker');
  // For now, fallback to proxy
  const tileCoords = boundsToTile(bounds, zoom);
  return proxyTileFromOSM(zoom, tileCoords.x, tileCoords.y);
}

/**
 * Helper: Convert bounds to tile coordinates (approximate)
 */
function boundsToTile(bounds, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((bounds.minLon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(bounds.maxLat * Math.PI / 180) + 1 / Math.cos(bounds.maxLat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y };
}

/**
 * Helper: Create empty tile (simple 1x1 PNG)
 */
async function createEmptyTile() {
  // Simple 1x1 white PNG
  const whitePNG = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x5C, 0x72, 0xA8, 0x66, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  return whitePNG;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OSRM Tile Service running on port ${PORT}`);
  console.log(`📍 Region: West Java (Jawa Barat)`);
  console.log(`🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png`);
  console.log(`🛣️  Route: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  console.log(`🎨 Tile Mode: ${TILE_MODE}`);
  console.log('');
  console.log('');
  console.log('💡 Endpoints:');
  console.log('   - GET /health - Health check');
  console.log('   - GET /route?start=lon,lat&end=lon,lat - Routing');
  console.log('   - GET /tiles/{z}/{x}/{y}.png - Map tiles');
  console.log('');
  console.log('🌐 Open browser: http://localhost:' + PORT);
});
