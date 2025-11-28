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
    // FOUND IT! Column 'way' exists with geometry(LineString, 3857)
    const query = `
      SELECT 
        name,
        highway,
        'road' as feature_type,
        ST_AsText(ST_Transform(way, 4326)) as geom_text,
        ST_GeometryType(way) as geom_type
      FROM planet_osm_line 
      WHERE way && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857)
      AND highway IS NOT NULL
      AND highway IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified')
      ORDER BY 
        CASE highway
          WHEN 'motorway' THEN 1
          WHEN 'trunk' THEN 2  
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 4
          WHEN 'tertiary' THEN 5
          ELSE 6
        END
      LIMIT 100
    `;

    const result = await pool.query(query, [
      bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat
    ]);

    console.log(`GEOMETRY FOUND! Query returned ${result.rows.length} roads with coordinates`);
    
    if (result.rows.length > 0) {
      console.log(`Sample with geometry:`, result.rows[0]);
      
      // Generate REAL OSM tile with actual coordinates!
      return await generateRealOSMTile(result.rows, bounds);
    } else {
      console.log(`No roads found for bounds: ${bounds.minLon.toFixed(4)},${bounds.minLat.toFixed(4)} to ${bounds.maxLon.toFixed(4)},${bounds.maxLat.toFixed(4)}`);
      return await createEmptyTile();
    }

  } catch (error) {
    console.error('Database rendering error:', error.message);
    
    // Try simple table check first
    try {
      // First, just see what tables exist
      const tablesQuery = `
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE 'planet_osm%'
        LIMIT 10
      `;
      
      const tablesResult = await pool.query(tablesQuery);
      console.log('Available tables:', tablesResult.rows.map(r => r.table_name).join(', '));
      
      // Try the most basic query possible
      const altQuery = `
        SELECT name, highway
        FROM planet_osm_line 
        WHERE highway IS NOT NULL
        LIMIT 5
      `;
      
      console.log('Trying basic query without geometry...');
      
      const altResult = await pool.query(altQuery);
      
      if (altResult.rows.length > 0) {
        console.log(`Basic query found ${altResult.rows.length} roads:`, altResult.rows.map(r => r.name || r.highway).join(', '));
        
        // Get column info for all OSM tables
        const tablesInfo = ['planet_osm_line', 'planet_osm_polygon', 'planet_osm_point'];
        
        for (let table of tablesInfo) {
          try {
            const columnsQuery = `
              SELECT column_name, data_type FROM information_schema.columns 
              WHERE table_name = '${table}'
              AND table_schema = 'public'
              ORDER BY ordinal_position
            `;
            
            const columnsResult = await pool.query(columnsQuery);
            console.log(`\n=== ${table.toUpperCase()} COLUMNS ===`);
            console.log(columnsResult.rows.map(r => `${r.column_name}(${r.data_type})`).join(', '));
            
            // Check if this table has geometry column
            const geomColumns = columnsResult.rows.filter(r => 
              r.column_name.includes('geom') || 
              r.column_name.includes('way') || 
              r.data_type.includes('geometry')
            );
            
            if (geomColumns.length > 0) {
              console.log(`Geometry columns in ${table}:`, geomColumns.map(c => c.column_name).join(', '));
              
              // Try to get actual data with the found geometry column
              const geomCol = geomColumns[0].column_name;
              const testQuery = `
                SELECT name, highway, ${geomCol} IS NOT NULL as has_geom,
                       ST_AsText(${geomCol}) as geom_text
                FROM ${table} 
                WHERE highway IS NOT NULL
                AND ${geomCol} IS NOT NULL
                LIMIT 3
              `;
              
              const testResult = await pool.query(testQuery);
              if (testResult.rows.length > 0) {
                console.log(`SUCCESS! Found geometry data in ${table}.${geomCol}`);
                console.log('Sample:', testResult.rows[0]);
                
                // Now render with correct column
                return await generateFullOSMTile(bounds, geomCol, table);
              }
            }
          } catch (e) {
            console.log(`Error checking ${table}:`, e.message);
          }
        }
        
        // If no geometry found, show the mock
        return await generateMockTileFromData(altResult.rows, bounds);
      }
    } catch (altError) {
      console.error('Alternative query also failed:', altError.message);
    }
    
    console.log('All database queries failed, falling back to proxy mode');
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
 * Helper: Generate simple road-only tile (fallback)
 */
async function generateSimpleRoadTile(features, bounds) {
  let roadPaths = [];
  
  features.forEach((feature, idx) => {
    if (feature.highway && feature.geom_text && feature.geom_text.startsWith('LINESTRING')) {
      try {
        const coordsText = feature.geom_text.replace('LINESTRING(', '').replace(')', '');
        const coordPairs = coordsText.split(',');
        
        const coords = [];
        for (let i = 0; i < Math.min(coordPairs.length, 10); i++) {
          const pair = coordPairs[i].trim().split(' ');
          if (pair.length >= 2) {
            const lon = parseFloat(pair[0]);
            const lat = parseFloat(pair[1]);
            if (!isNaN(lon) && !isNaN(lat)) {
              const pixel = latLonToPixel(lat, lon, bounds);
              coords.push(pixel);
            }
          }
        }

        if (coords.length >= 2) {
          const color = feature.highway === 'primary' ? '#e74c3c' : 
                       feature.highway === 'secondary' ? '#f39c12' : 
                       feature.highway === 'trunk' ? '#8e44ad' : '#666';
          const width = feature.highway === 'trunk' ? 3 : 
                       feature.highway === 'primary' ? 2.5 : 2;

          const pathData = `M ${coords[0].x} ${coords[0].y} ` + 
            coords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ');

          roadPaths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" opacity="0.8"/>`);
        }
      } catch (e) {
        console.error(`Error parsing simple road: ${e.message}`);
      }
    }
  });

  function latLonToPixel(lat, lon, bounds) {
    const lonRange = bounds.maxLon - bounds.minLon;
    const latRange = bounds.maxLat - bounds.minLat;
    
    if (lonRange <= 0 || latRange <= 0) {
      return { x: 128, y: 128 };
    }
    
    const x = ((lon - bounds.minLon) / lonRange) * 256;
    const y = ((bounds.maxLat - lat) / latRange) * 256;
    
    return { x: Math.max(0, Math.min(256, x)), y: Math.max(0, Math.min(256, y)) };
  }

  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="#f8f8f8"/>
      ${roadPaths.join('\n      ')}
      <rect x="5" y="5" width="100" height="25" fill="rgba(255,255,255,0.9)" stroke="#ccc" rx="2"/>
      <text x="10" y="20" font-family="Arial" font-size="9" fill="#333">
        Simple: ${roadPaths.length} roads
      </text>
    </svg>
  `;

  console.log(`Generated simple road tile: ${roadPaths.length} roads`);
  return Buffer.from(svg, 'utf8');
}

/**
 * Helper: Generate mock tile from database data (no geometry)
 */
async function generateMockTileFromData(features, bounds) {
  // Create a tile showing that we have data but geometry is missing
  const roadTypes = {};
  features.forEach(f => {
    if (f.highway) {
      roadTypes[f.highway] = (roadTypes[f.highway] || 0) + 1;
    }
  });

  const roadList = Object.entries(roadTypes)
    .map(([type, count]) => `${type}(${count})`)
    .join(', ');

  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="#f0f0f0"/>
      
      <!-- Mock road pattern -->
      <line x1="50" y1="128" x2="206" y2="128" stroke="#e74c3c" stroke-width="3"/>
      <line x1="128" y1="50" x2="128" y2="206" stroke="#3498db" stroke-width="2"/>
      <line x1="50" y1="80" x2="206" y2="176" stroke="#f39c12" stroke-width="2"/>
      
      <!-- Data info -->
      <rect x="10" y="10" width="236" height="60" fill="rgba(255,255,255,0.95)" stroke="#666" rx="3"/>
      <text x="20" y="30" font-family="Arial" font-size="12" fill="#333" font-weight="bold">
        DATABASE CONNECTED! 🎉
      </text>
      <text x="20" y="45" font-family="Arial" font-size="10" fill="#666">
        Found ${features.length} features in DB
      </text>
      <text x="20" y="58" font-family="Arial" font-size="8" fill="#888">
        ${roadList}
      </text>
      
      <!-- Status -->
      <rect x="10" y="180" width="236" height="30" fill="rgba(255,255,255,0.95)" stroke="#666" rx="3"/>
      <text x="20" y="198" font-family="Arial" font-size="10" fill="#e74c3c">
        Geometry column issue - need to fix schema
      </text>
    </svg>
  `;

  console.log(`Generated mock tile showing ${features.length} database features`);
  return Buffer.from(svg, 'utf8');
}

/**
 * Helper: Generate full OSM-style tile with correct column names
 */
async function generateFullOSMTile(bounds, geomColumn, mainTable) {
  console.log(`Generating full OSM tile using ${mainTable}.${geomColumn}`);
  
  try {
    // Query all features with the correct geometry column
    const fullQuery = `
      -- Roads
      SELECT 
        name,
        highway,
        'road' as feature_type,
        ST_AsText(${geomColumn}) as geom_text,
        ST_GeometryType(${geomColumn}) as geom_type
      FROM ${mainTable}
      WHERE ${geomColumn} && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      AND highway IS NOT NULL
      AND highway IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified')
      LIMIT 100
    `;
    
    const result = await pool.query(fullQuery, [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat]);
    console.log(`Full query returned ${result.rows.length} features`);
    
    let roadPaths = [];
    let roadLabels = [];
    
    result.rows.forEach((feature, idx) => {
      if (feature.geom_text && feature.geom_text.startsWith('LINESTRING')) {
        try {
          const coords = parseLineString(feature.geom_text, bounds);
          
          if (coords.length >= 2) {
            // OSM-style colors
            const color = getOSMRoadColor(feature.highway);
            const width = getOSMRoadWidth(feature.highway);
            
            const pathData = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} ` + 
              coords.slice(1).map(c => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

            roadPaths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" opacity="0.9"/>`);
            
            // Add road labels
            if (feature.name && coords.length >= 2) {
              const midIdx = Math.floor(coords.length / 2);
              const midPoint = coords[midIdx];
              
              roadLabels.push(`
                <text x="${midPoint.x}" y="${midPoint.y}" 
                      font-family="Arial" font-size="8" fill="#333" 
                      text-anchor="middle" 
                      style="font-weight: bold; stroke: white; stroke-width: 2; paint-order: stroke;">
                  ${feature.name}
                </text>
              `);
            }
          }
        } catch (e) {
          console.error(`Error processing road ${idx}:`, e.message);
        }
      }
    });

    // Generate OSM-style SVG
    let svg = `
      <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
        <!-- OSM-style background -->
        <rect width="256" height="256" fill="#f2efe9"/>
        
        <!-- Roads with proper styling -->
        ${roadPaths.join('\n        ')}
        
        <!-- Road labels -->
        ${roadLabels.join('\n        ')}
        
        <!-- OSM-style info -->
        <rect x="3" y="3" width="150" height="30" fill="rgba(255,255,255,0.95)" stroke="#ccc" rx="2"/>
        <text x="8" y="16" font-family="Arial" font-size="9" fill="#333" font-weight="bold">
          OSM Local: ${roadPaths.length} roads
        </text>
        <text x="8" y="26" font-size="7" fill="#666" font-family="monospace">
          ${bounds.minLon.toFixed(4)},${bounds.minLat.toFixed(4)}
        </text>
      </svg>
    `;

    console.log(`Generated full OSM tile: ${roadPaths.length} roads, ${roadLabels.length} labels`);
    return Buffer.from(svg, 'utf8');

  } catch (error) {
    console.error('Error in generateFullOSMTile:', error.message);
    throw error;
  }
}

function parseLineString(wkt, bounds) {
  const coordsText = wkt.replace('LINESTRING(', '').replace(')', '');
  const coordPairs = coordsText.split(',');
  const coords = [];
  
  for (let i = 0; i < Math.min(coordPairs.length, 20); i++) {
    const pair = coordPairs[i].trim().split(' ');
    if (pair.length >= 2) {
      const lon = parseFloat(pair[0]);
      const lat = parseFloat(pair[1]);
      if (!isNaN(lon) && !isNaN(lat)) {
        const pixel = coordToPixel(lat, lon, bounds);
        coords.push(pixel);
      }
    }
  }
  return coords;
}

function coordToPixel(lat, lon, bounds) {
  const lonRange = bounds.maxLon - bounds.minLon;
  const latRange = bounds.maxLat - bounds.minLat;
  
  if (lonRange <= 0 || latRange <= 0) {
    return { x: 128, y: 128 };
  }
  
  const x = ((lon - bounds.minLon) / lonRange) * 256;
  const y = ((bounds.maxLat - lat) / latRange) * 256;
  
  return { x: Math.max(0, Math.min(256, x)), y: Math.max(0, Math.min(256, y)) };
}

function getOSMRoadColor(highway) {
  const colors = {
    'motorway': '#e892a2',
    'trunk': '#f9b29c', 
    'primary': '#fcd6a4',
    'secondary': '#f7fabf',
    'tertiary': '#ffffff',
    'residential': '#ffffff',
    'service': '#ffffff',
    'unclassified': '#ffffff'
  };
  return colors[highway] || '#cccccc';
}

function getOSMRoadWidth(highway) {
  const widths = {
    'motorway': 5,
    'trunk': 4,
    'primary': 3.5,
    'secondary': 3,
    'tertiary': 2.5,
    'residential': 2,
    'service': 1.5,
    'unclassified': 2
  };
  return widths[highway] || 1.5;
}

/**
 * Helper: Generate schematic tile from road data (no geometry)
 */
async function generateSchematicTile(roads, bounds) {
  console.log(`Generating schematic tile with ${roads.length} roads`);
  
  // Group roads by type
  const roadGroups = {};
  roads.forEach(road => {
    if (!roadGroups[road.highway]) {
      roadGroups[road.highway] = [];
    }
    roadGroups[road.highway].push(road);
  });

  let roadElements = [];
  let labels = [];
  
  // Generate schematic road network
  let yPos = 40;
  
  Object.entries(roadGroups).forEach(([highway, roadList]) => {
    const color = getOSMRoadColor(highway);
    const width = getOSMRoadWidth(highway);
    
    // Horizontal main road
    roadElements.push(`
      <line x1="20" y1="${yPos}" x2="236" y2="${yPos}" 
            stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="0.9"/>
    `);
    
    // Branching roads
    for (let i = 0; i < Math.min(roadList.length, 3); i++) {
      const x = 50 + (i * 60);
      roadElements.push(`
        <line x1="${x}" y1="${yPos}" x2="${x + 20}" y2="${yPos + 30}" 
              stroke="${color}" stroke-width="${width * 0.7}" stroke-linecap="round" opacity="0.7"/>
      `);
      
      // Add road name if available
      if (roadList[i].name) {
        labels.push(`
          <text x="${x + 10}" y="${yPos + 45}" font-family="Arial" font-size="7" 
                fill="#333" text-anchor="middle" 
                style="stroke: white; stroke-width: 1; paint-order: stroke;">
            ${roadList[i].name.substring(0, 15)}
          </text>
        `);
      }
    }
    
    // Highway type label
    labels.push(`
      <text x="25" y="${yPos - 5}" font-family="Arial" font-size="9" 
            fill="#333" font-weight="bold">
        ${highway.toUpperCase()}
      </text>
    `);
    
    yPos += 50;
  });

  // Generate comprehensive SVG
  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <!-- OSM-style background -->
      <rect width="256" height="256" fill="#f2efe9"/>
      
      <!-- Title -->
      <rect x="10" y="5" width="236" height="25" fill="rgba(255,255,255,0.95)" stroke="#666" rx="3"/>
      <text x="128" y="20" font-family="Arial" font-size="12" fill="#333" 
            text-anchor="middle" font-weight="bold">
        🗺️ OSM Database Connected - Bandung Area
      </text>
      
      <!-- Schematic road network -->
      ${roadElements.join('')}
      
      <!-- Road labels -->
      ${labels.join('')}
      
      <!-- Info panel -->
      <rect x="10" y="200" width="236" height="45" fill="rgba(255,255,255,0.95)" stroke="#666" rx="3"/>
      <text x="20" y="215" font-family="Arial" font-size="10" fill="#333" font-weight="bold">
        Database: ${roads.length} roads found
      </text>
      <text x="20" y="228" font-family="Arial" font-size="9" fill="#666">
        Types: ${Object.keys(roadGroups).join(', ')}
      </text>
      <text x="20" y="240" font-family="Arial" font-size="8" fill="#e74c3c">
        ⚠️ Geometry columns missing - need PostGIS import
      </text>
    </svg>
  `;

  console.log(`Generated schematic tile: ${Object.keys(roadGroups).length} road types`);
  return Buffer.from(svg, 'utf8');
}

/**
 * Helper: Generate REAL OSM tile with actual geometry coordinates
 */
async function generateRealOSMTile(features, bounds) {
  console.log(`Generating REAL OSM tile with ${features.length} features and actual coordinates`);
  
  let roadPaths = [];
  let roadLabels = [];
  
  features.forEach((feature, idx) => {
    if (feature.geom_text && feature.geom_text.startsWith('LINESTRING')) {
      try {
        const coords = parseLineString(feature.geom_text, bounds);
        
        if (coords.length >= 2) {
          // Real OSM colors
          const color = getRealOSMColor(feature.highway);
          const width = getRealOSMWidth(feature.highway);
          
          const pathData = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} ` + 
            coords.slice(1).map(c => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

          roadPaths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" opacity="0.9"/>`);
          
          // Add street names
          if (feature.name && coords.length >= 3) {
            const midIdx = Math.floor(coords.length / 2);
            const midPoint = coords[midIdx];
            
            // Calculate text angle based on road direction
            const p1 = coords[Math.max(0, midIdx - 1)];
            const p2 = coords[Math.min(coords.length - 1, midIdx + 1)];
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
            
            roadLabels.push(`
              <text x="${midPoint.x}" y="${midPoint.y}" 
                    font-family="Arial" font-size="8" fill="#333" 
                    text-anchor="middle" 
                    transform="rotate(${angle} ${midPoint.x} ${midPoint.y})"
                    style="font-weight: bold; stroke: white; stroke-width: 2; paint-order: stroke;">
                ${feature.name}
              </text>
            `);
          }
        }
      } catch (e) {
        console.error(`Error processing feature ${idx}:`, e.message);
      }
    }
  });

  // Generate proper OSM-style tile
  let svg = `
    <svg width="256" height="256" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <!-- Real OSM background color -->
      <rect width="256" height="256" fill="#f2efe9"/>
      
      <!-- Real road network with actual coordinates -->
      ${roadPaths.join('\n      ')}
      
      <!-- Street name labels -->
      ${roadLabels.join('\n      ')}
      
      <!-- Success indicator -->
      <rect x="3" y="3" width="180" height="30" fill="rgba(255,255,255,0.95)" stroke="#4CAF50" stroke-width="2" rx="2"/>
      <text x="8" y="16" font-family="Arial" font-size="9" fill="#4CAF50" font-weight="bold">
        ✅ REAL OSM TILE - ${roadPaths.length} roads rendered
      </text>
      <text x="8" y="26" font-size="7" fill="#666" font-family="monospace">
        ${bounds.minLon.toFixed(4)},${bounds.minLat.toFixed(4)} → ${bounds.maxLon.toFixed(4)},${bounds.maxLat.toFixed(4)}
      </text>
    </svg>
  `;

  console.log(`SUCCESS! Generated real OSM tile: ${roadPaths.length} roads, ${roadLabels.length} labels`);
  return Buffer.from(svg, 'utf8');
}

function getRealOSMColor(highway) {
  // Real OpenStreetMap color scheme
  const colors = {
    'motorway': '#e892a2',      // Pink untuk highway
    'trunk': '#f9b29c',         // Orange untuk trunk  
    'primary': '#fcd6a4',       // Light orange untuk primary
    'secondary': '#f7fabf',     // Yellow untuk secondary
    'tertiary': '#ffffff',      // White untuk tertiary
    'residential': '#ffffff',   // White untuk residential  
    'service': '#ffffff',       // White untuk service
    'unclassified': '#ffffff'   // White untuk unclassified
  };
  return colors[highway] || '#cccccc';
}

function getRealOSMWidth(highway) {
  // Real OpenStreetMap width hierarchy
  const widths = {
    'motorway': 6,
    'trunk': 5,
    'primary': 4,
    'secondary': 3,
    'tertiary': 2.5,
    'residential': 2,
    'service': 1.5,
    'unclassified': 2
  };
  return widths[highway] || 1.5;
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
