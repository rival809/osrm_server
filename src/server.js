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
 * Helper: Convert tile coordinates to lat/lon bounds (standard slippy map)
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
    // Comprehensive query for complete map rendering
    const query = `
      -- Buildings (polygons)
      SELECT 
        name,
        'building' as feature_type,
        building,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_polygon 
      WHERE ST_Transform(way, 4326) && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND building IS NOT NULL
      
      UNION ALL
      
      -- Landuse areas (parks, residential, etc)
      SELECT 
        name,
        'landuse' as feature_type,
        landuse,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_polygon 
      WHERE ST_Transform(way, 4326) && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND landuse IN ('residential', 'commercial', 'industrial', 'forest', 'grass', 'park')
      
      UNION ALL
      
      -- Roads with names
      SELECT 
        name,
        'highway' as feature_type,
        highway,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_line 
      WHERE ST_Transform(way, 4326) && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND highway IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service')
      
      UNION ALL
      
      -- Points of Interest
      SELECT 
        name,
        'poi' as feature_type,
        amenity,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_point 
      WHERE ST_Transform(way, 4326) && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND amenity IN ('restaurant', 'hospital', 'school', 'fuel', 'bank', 'atm', 'pharmacy')
      
      ORDER BY feature_type, ST_Area(ST_Transform(way, 4326)) DESC
      LIMIT 500
    `;

    const result = await pool.query(query, [
      bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat
    ]);

    // Debug tile bounds and data
    console.log(`Tile bounds: ${bounds.minLon.toFixed(4)},${bounds.minLat.toFixed(4)} to ${bounds.maxLon.toFixed(4)},${bounds.maxLat.toFixed(4)}`);
    
    if (result.rows.length > 0) {
      console.log(`Rendering tile with ${result.rows.length} features from database`);
      console.log(`Sample feature: ${result.rows[0].highway || result.rows[0].amenity} - ${result.rows[0].geom_type}`);
      return await generateSimpleTile(result.rows, bounds);
    } else {
      console.log('No data found in database for this tile bounds');
      console.log(`Query bounds: minLon=${bounds.minLon}, minLat=${bounds.minLat}, maxLon=${bounds.maxLon}, maxLat=${bounds.maxLat}`);
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
 * Helper: Generate comprehensive map tile from database features
 */
async function generateSimpleTile(features, bounds) {
  // Categorize features
  let buildings = [];
  let landuse = [];
  let roads = [];
  let points = [];
  
  // Process all features from database
  features.forEach(feature => {
    if (feature.feature_type === 'building' && feature.geom_type === 'ST_Polygon') {
      buildings.push({
        name: feature.name || '',
        building: feature.building,
        geom_text: feature.geom_text
      });
    } else if (feature.feature_type === 'landuse' && feature.geom_type === 'ST_Polygon') {
      landuse.push({
        name: feature.name || '',
        landuse: feature.landuse,
        geom_text: feature.geom_text
      });
    } else if (feature.feature_type === 'highway' && feature.geom_type === 'ST_LineString') {
      roads.push({
        name: feature.name || '',
        highway: feature.highway,
        geom_text: feature.geom_text
      });
    } else if (feature.feature_type === 'poi' && feature.geom_type === 'ST_Point') {
      points.push({
        name: feature.name || '',
        amenity: feature.amenity,
        geom_text: feature.geom_text
      });
    }
  });

  // Helper: Convert lat/lon to tile pixel coordinates (Web Mercator projection)
  function latLonToPixel(lat, lon) {
    // Ensure we have valid bounds
    const lonRange = bounds.maxLon - bounds.minLon;
    const latRange = bounds.maxLat - bounds.minLat;
    
    if (lonRange <= 0 || latRange <= 0) {
      return { x: 128, y: 128 }; // Center fallback
    }
    
    // Clamp coordinates to tile bounds
    const clampedLon = Math.max(bounds.minLon, Math.min(bounds.maxLon, lon));
    const clampedLat = Math.max(bounds.minLat, Math.min(bounds.maxLat, lat));
    
    // Linear mapping to 256x256 pixel space
    const x = ((clampedLon - bounds.minLon) / lonRange) * 256;
    const y = ((bounds.maxLat - clampedLat) / latRange) * 256; // Flip Y axis for SVG
    
    return { 
      x: Math.max(0, Math.min(256, x)), 
      y: Math.max(0, Math.min(256, y)) 
    };
  }

  // Parse WKT geometry and convert to SVG elements
  let landusePolygons = [];
  let buildingPolygons = [];
  let roadPaths = [];
  let roadLabels = [];
  let poiCircles = [];

  // Process landuse areas (background)
  landuse.slice(0, 20).forEach((area, idx) => {
    if (area.geom_text && area.geom_text.startsWith('POLYGON')) {
      try {
        const polygon = parsePolygonWKT(area.geom_text);
        if (polygon.length >= 3) {
          const color = area.landuse === 'forest' ? '#90ee90' :
                       area.landuse === 'park' ? '#c8facc' :
                       area.landuse === 'residential' ? '#f0f0f0' :
                       area.landuse === 'commercial' ? '#fdf4e3' :
                       area.landuse === 'industrial' ? '#e6e6e6' : '#f5f5f5';
          
          const pathData = `M ${polygon[0].x} ${polygon[0].y} ` +
            polygon.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z';
          
          landusePolygons.push(`<path d="${pathData}" fill="${color}" stroke="#ddd" stroke-width="0.5" opacity="0.7"/>`);
        }
      } catch (e) {
        console.error(`Error parsing landuse: ${e.message}`);
      }
    }
  });

  // Process buildings
  buildings.slice(0, 100).forEach((building, idx) => {
    if (building.geom_text && building.geom_text.startsWith('POLYGON')) {
      try {
        const polygon = parsePolygonWKT(building.geom_text);
        if (polygon.length >= 3) {
          const pathData = `M ${polygon[0].x} ${polygon[0].y} ` +
            polygon.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z';
          
          buildingPolygons.push(`<path d="${pathData}" fill="#d9d0c7" stroke="#bbb" stroke-width="0.8" opacity="0.9"/>`);
        }
      } catch (e) {
        console.error(`Error parsing building: ${e.message}`);
      }
    }
  });

  // Helper function to parse POLYGON WKT
  function parsePolygonWKT(wkt) {
    const coordsText = wkt.replace('POLYGON((', '').replace('))', '');
    const coordPairs = coordsText.split(',');
    const coords = [];
    
    for (let i = 0; i < Math.min(coordPairs.length, 20); i++) {
      const pair = coordPairs[i].trim().split(' ');
      if (pair.length >= 2) {
        const lon = parseFloat(pair[0]);
        const lat = parseFloat(pair[1]);
        if (!isNaN(lon) && !isNaN(lat)) {
          coords.push(latLonToPixel(lat, lon));
        }
      }
    }
    return coords;
  }

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
          const color = road.highway === 'motorway' ? '#1565C0' : 
                       road.highway === 'trunk' ? '#D32F2F' : 
                       road.highway === 'primary' ? '#F57C00' : 
                       road.highway === 'secondary' ? '#FBC02D' : 
                       road.highway === 'tertiary' ? '#689F38' : 
                       road.highway === 'residential' ? '#9E9E9E' : 
                       road.highway === 'unclassified' ? '#757575' : '#BDBDBD';
          const width = road.highway === 'motorway' ? 5 :
                       road.highway === 'trunk' ? 4 : 
                       road.highway === 'primary' ? 3 : 
                       road.highway === 'secondary' ? 2.5 : 
                       road.highway === 'tertiary' ? 2 : 1.2;

          const pathData = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} ` + 
            coords.slice(1).map(c => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

          roadPaths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" opacity="0.9" stroke-linecap="round"/>`);
          
          // Add road name label if exists
          if (road.name && coords.length >= 2) {
            const midPoint = coords[Math.floor(coords.length / 2)];
            const angle = Math.atan2(coords[coords.length - 1].y - coords[0].y, coords[coords.length - 1].x - coords[0].x) * 180 / Math.PI;
            
            roadLabels.push(`
              <text x="${midPoint.x}" y="${midPoint.y}" 
                    font-family="Arial" font-size="8" fill="#333" 
                    text-anchor="middle" transform="rotate(${angle} ${midPoint.x} ${midPoint.y})"
                    style="font-weight: bold; stroke: white; stroke-width: 2; paint-order: stroke;">
                ${road.name}
              </text>
            `);
          }
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

  // Create comprehensive map SVG
  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <!-- Background -->
      <rect width="256" height="256" fill="#f9f9f9"/>
      
      <!-- Landuse areas (drawn first, as background) -->
      ${landusePolygons.join('\n      ')}
      
      <!-- Buildings (drawn second) -->
      ${buildingPolygons.join('\n      ')}
      
      <!-- Roads (drawn third) -->
      ${roadPaths.join('\n      ')}
      
      <!-- Road labels (drawn fourth) -->
      ${roadLabels.join('\n      ')}
      
      <!-- Points of Interest (drawn on top) -->
      ${poiCircles.join('\n      ')}
      
      <!-- Map info -->
      <rect x="3" y="220" width="180" height="32" fill="rgba(255,255,255,0.95)" stroke="#bbb" stroke-width="1" rx="2"/>
      <text x="8" y="235" font-family="Arial" font-size="8" fill="#333">
        🏢${buildingPolygons.length} 🛣️${roadPaths.length} 📍${poiCircles.length} 🌿${landusePolygons.length}
      </text>
      <text x="8" y="245" font-size="7" fill="#666" font-family="monospace">
        ${bounds.minLon.toFixed(4)},${bounds.minLat.toFixed(4)} → ${bounds.maxLon.toFixed(4)},${bounds.maxLat.toFixed(4)}
      </text>
    </svg>
  `;

  console.log(`Generated comprehensive tile: ${buildingPolygons.length} buildings, ${roadPaths.length} roads, ${poiCircles.length} POIs, ${landusePolygons.length} landuse`);
  
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
