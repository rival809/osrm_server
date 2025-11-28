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
const TILE_MODE = process.env.TILE_MODE || 'render'; // 'proxy' or 'render'

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
      if (TILE_MODE === 'render') {
        res.set('Content-Type', 'image/svg+xml');
      } else {
        res.set('Content-Type', 'image/png');
      }
      res.set('X-Cache', 'HIT');
      return res.send(cachedTile);
    }

    // Calculate tile bounds
    const bounds = tileToBounds(tileX, tileY, zoom);

    // Cek apakah tile dalam batas Jawa Barat
    if (!isTileInWestJava(bounds)) {
      // Return empty tile jika di luar Jawa Barat
      const emptyTile = await createEmptyTile();
      res.set('Content-Type', 'image/svg+xml');
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

    // Set correct content type based on tile mode
    if (TILE_MODE === 'render') {
      res.set('Content-Type', 'image/svg+xml');
    } else {
      res.set('Content-Type', 'image/png');
    }
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
 * Helper: Render tile from database using PostGIS
 */
async function renderTileFromDB(bounds, zoom) {
  try {
    // Query PostGIS untuk data dalam bounds dengan koordinat yang lebih sederhana
    const query = `
      SELECT 
        name,
        highway,
        amenity,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_line 
      WHERE way && ST_Transform(
        ST_MakeEnvelope($1, $2, $3, $4, 4326), 
        3857
      )
      AND highway IN ('primary', 'secondary', 'trunk', 'tertiary', 'residential')
      UNION ALL
      SELECT 
        name,
        NULL as highway,
        amenity,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_point 
      WHERE way && ST_Transform(
        ST_MakeEnvelope($1, $2, $3, $4, 4326), 
        3857
      )
      AND amenity IS NOT NULL
      LIMIT 200
    `;

    const result = await pool.query(query, [
      bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat
    ]);

    // Simple tile generation - return SVG as PNG
    if (result.rows.length > 0) {
      console.log(`Rendering tile with ${result.rows.length} features from database`);
      return await generateSimpleTile(result.rows, bounds);
    } else {
      console.log('No data found in database for this tile, using empty tile');
      return await createEmptyTile();
    }

  } catch (error) {
    console.error('Database rendering error:', error.message);
    console.log('Falling back to proxy mode for this tile');
    // Fallback to proxy
    const tileCoords = boundsToTile(bounds, zoom);
    return proxyTileFromOSM(zoom, tileCoords.x, tileCoords.y);
  }
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
 * Helper: Generate simple tile from database features
 */
async function generateSimpleTile(features, bounds) {
  // Generate SVG tile dengan proper coordinate mapping
  let roads = [];
  let points = [];
  
  // Process features from database
  features.forEach(feature => {
    if (feature.highway && feature.geom_type === 'ST_LineString') {
      roads.push({
        name: feature.name || '',
        highway: feature.highway,
        geom_text: feature.geom_text
      });
    } else if (feature.amenity && feature.geom_type === 'ST_Point') {
      points.push({
        name: feature.name || '',
        amenity: feature.amenity,
        geom_text: feature.geom_text
      });
    }
  });

  // Helper: Convert lat/lon to tile pixel coordinates
  function latLonToPixel(lat, lon) {
    // Ensure we have valid bounds
    const lonRange = bounds.maxLon - bounds.minLon;
    const latRange = bounds.maxLat - bounds.minLat;
    
    if (lonRange <= 0 || latRange <= 0) {
      return { x: 128, y: 128 }; // Center fallback
    }
    
    // Map coordinates to 256x256 pixel space
    const x = ((lon - bounds.minLon) / lonRange) * 256;
    const y = ((bounds.maxLat - lat) / latRange) * 256; // Flip Y axis
    
    return { x, y };
  }

  // Parse WKT geometry and convert to SVG paths
  let roadPaths = [];
  let poiCircles = [];

  roads.slice(0, 30).forEach((road, idx) => {
    if (road.geom_text && road.geom_text.startsWith('LINESTRING')) {
      try {
        // Parse LINESTRING(lon lat, lon lat, ...)
        const coordsText = road.geom_text.replace('LINESTRING(', '').replace(')', '');
        const coordPairs = coordsText.split(',');
        
        const coords = [];
        for (let i = 0; i < Math.min(coordPairs.length, 10); i++) {
          const pair = coordPairs[i].trim().split(' ');
          if (pair.length >= 2) {
            const lon = parseFloat(pair[0]);
            const lat = parseFloat(pair[1]);
            
            if (!isNaN(lon) && !isNaN(lat)) {
              const pixel = latLonToPixel(lat, lon);
              // Only add if coordinates are within tile bounds
              if (pixel.x >= -50 && pixel.x <= 306 && pixel.y >= -50 && pixel.y <= 306) {
                coords.push(pixel);
              }
            }
          }
        }

        if (coords.length >= 2) {
          const color = road.highway === 'primary' ? '#e74c3c' : 
                       road.highway === 'secondary' ? '#f39c12' : 
                       road.highway === 'trunk' ? '#8e44ad' : 
                       road.highway === 'tertiary' ? '#3498db' : 
                       road.highway === 'residential' ? '#95a5a6' : '#7f8c8d';
          const width = road.highway === 'trunk' ? 4 :
                       road.highway === 'primary' ? 3 : 
                       road.highway === 'secondary' ? 2.5 : 
                       road.highway === 'tertiary' ? 2 : 1.5;

          const pathData = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} ` + 
            coords.slice(1).map(c => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

          roadPaths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" opacity="0.9" stroke-linecap="round"/>`);
        }
      } catch (e) {
        console.error(`Error parsing road geometry: ${e.message}`);
      }
    }
  });

  points.slice(0, 20).forEach((poi, idx) => {
    if (poi.geom_text && poi.geom_text.startsWith('POINT')) {
      try {
        // Parse POINT(lon lat)
        const match = poi.geom_text.match(/POINT\(([0-9.-]+)\s+([0-9.-]+)\)/);
        if (match) {
          const lon = parseFloat(match[1]);
          const lat = parseFloat(match[2]);
          
          if (!isNaN(lon) && !isNaN(lat)) {
            const pixel = latLonToPixel(lat, lon);
            
            // Only add if coordinates are within reasonable tile bounds
            if (pixel.x >= 0 && pixel.x <= 256 && pixel.y >= 0 && pixel.y <= 256) {
              const color = poi.amenity === 'restaurant' ? '#e67e22' :
                           poi.amenity === 'hospital' ? '#27ae60' :
                           poi.amenity === 'school' ? '#2980b9' :
                           poi.amenity === 'fuel' ? '#f1c40f' : '#9b59b6';
              
              poiCircles.push(`<circle cx="${pixel.x.toFixed(1)}" cy="${pixel.y.toFixed(1)}" r="4" fill="${color}" opacity="0.8" stroke="white" stroke-width="1"/>`);
            }
          }
        }
      } catch (e) {
        console.error(`Error parsing POI geometry: ${e.message}`);
      }
    }
  });

  // Create SVG with proper map styling
  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <!-- Background -->
      <rect width="256" height="256" fill="#f8f8f8"/>
      
      <!-- Tile border for debugging -->
      <rect x="0" y="0" width="256" height="256" fill="none" stroke="#e0e0e0" stroke-width="0.5"/>
      
      <!-- Roads (drawn first, under POIs) -->
      ${roadPaths.join('\n      ')}
      
      <!-- Points of Interest (drawn on top) -->
      ${poiCircles.join('\n      ')}
      
      <!-- Debug info -->
      <rect x="3" y="3" width="120" height="32" fill="rgba(255,255,255,0.95)" stroke="#bbb" stroke-width="1" rx="2"/>
      <text x="8" y="16" font-family="monospace" font-size="9" fill="#333">
        Roads: ${roadPaths.length}/${roads.length}
      </text>
      <text x="8" y="26" font-size="8" fill="#666" font-family="monospace">
        POIs: ${poiCircles.length}/${points.length}
      </text>
      
      <!-- Bounds info (small text) -->
      <text x="200" y="250" font-size="6" fill="#999" font-family="monospace">
        ${bounds.minLon.toFixed(3)},${bounds.minLat.toFixed(3)}
      </text>
    </svg>
  `;

  console.log(`Generated tile: ${roadPaths.length} road paths, ${poiCircles.length} POI circles`);
  
  return Buffer.from(svg, 'utf8');
}

/**
 * Helper: Create empty tile (simple 256x256 SVG)
 */
async function createEmptyTile() {
  // Simple 256x256 light gray SVG tile
  const emptySVG = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#f0f0f0"/>
      <text x="128" y="128" text-anchor="middle" font-family="Arial" font-size="12" fill="#ccc">
        Outside Region
      </text>
      <text x="128" y="145" text-anchor="middle" font-family="Arial" font-size="10" fill="#ddd">
        West Java Only
      </text>
    </svg>
  `;
  return Buffer.from(emptySVG, 'utf8');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 OSRM Tile Service running on port ${PORT}`);
  console.log(`📍 Region: West Java (Jawa Barat)`);
  console.log(`🗺️  Tiles: http://localhost:${PORT}/tiles/{z}/{x}/{y}.png`);
  console.log(`🛣️  Route: http://localhost:${PORT}/route?start=lon,lat&end=lon,lat`);
  console.log(`🎨 Tile Mode: ${TILE_MODE}`);
  if (TILE_MODE === 'render') {
    console.log(`🗄️  Database: PostgreSQL + PostGIS`);
  } else {
    console.log(`🌐 Source: OpenStreetMap proxy`);
  }
  console.log('');
  console.log('');
  console.log('💡 Endpoints:');
  console.log('   - GET /health - Health check');
  console.log('   - GET /route?start=lon,lat&end=lon,lat - Routing');
  console.log('   - GET /tiles/{z}/{x}/{y}.png - Map tiles');
  console.log('');
  console.log('🌐 Open browser: http://localhost:' + PORT);
});
