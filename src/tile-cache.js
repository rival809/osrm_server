/**
 * Tile Cache Management System
 * Handles persistent file-based caching of OSM tiles with preload capabilities
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');

class TileCacheManager {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || './cache';
    this.maxCacheSizeMB = options.maxCacheSizeMB || 1000; // 1GB
    this.userAgent = options.userAgent || 'OSRM-Tile-Cache-Service/1.0';
    
    // OSM tile servers for load balancing
    this.osmServers = [
      'https://tile.openstreetmap.org',
      'https://a.tile.openstreetmap.org',
      'https://b.tile.openstreetmap.org',
      'https://c.tile.openstreetmap.org'
    ];
    this.currentServerIndex = 0;
    
    // West Java bounds
    this.westJavaBounds = {
      minLon: 104.5,
      minLat: -7.8,
      maxLon: 108.8,
      maxLat: -5.8
    };
    
    this.initializeCacheDirectories();
  }
  
  // Initialize cache directory structure
  initializeCacheDirectories() {
    const dirs = [
      this.cacheDir,
      path.join(this.cacheDir, 'tiles'),
      path.join(this.cacheDir, 'metadata'),
      path.join(this.cacheDir, 'preload')
    ];
    
    for (const dir of dirs) {
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  // Generate cache file paths
  getTileCachePath(z, x, y) {
    const dir = path.join(this.cacheDir, 'tiles', z.toString(), x.toString());
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${y}.png`);
  }
  
  getTileMetadataPath(z, x, y) {
    const dir = path.join(this.cacheDir, 'metadata', z.toString(), x.toString());
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${y}.json`);
  }
  
  // Check if tile is cached (persistent cache - no expiration)
  async isTileCached(z, x, y) {
    try {
      const tilePath = this.getTileCachePath(z, x, y);
      const metaPath = this.getTileMetadataPath(z, x, y);
      
      return fsSync.existsSync(tilePath) && fsSync.existsSync(metaPath);
    } catch (error) {
      return false;
    }
  }
  
  // Load tile from cache
  async loadTileFromCache(z, x, y) {
    try {
      const tilePath = this.getTileCachePath(z, x, y);
      return await fs.readFile(tilePath);
    } catch (error) {
      return null;
    }
  }
  
  // Save tile to cache
  async saveTileToCache(z, x, y, tileBuffer, metadata = {}) {
    try {
      const tilePath = this.getTileCachePath(z, x, y);
      const metaPath = this.getTileMetadataPath(z, x, y);
      
      await fs.writeFile(tilePath, tileBuffer);
      
      const tileMetadata = {
        timestamp: Date.now(),
        size: tileBuffer.length,
        zoom: z,
        x: x,
        y: y,
        source: 'osm',
        ...metadata
      };
      
      await fs.writeFile(metaPath, JSON.stringify(tileMetadata, null, 2));
      return true;
    } catch (error) {
      console.error(`Error saving tile ${z}/${x}/${y} to cache:`, error.message);
      return false;
    }
  }
  
  // Download tile from OSM with retry and load balancing
  async downloadTileFromOSM(z, x, y, retries = 3) {
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const serverUrl = this.osmServers[this.currentServerIndex];
        const tileUrl = `${serverUrl}/${z}/${x}/${y}.png`;
        
        const response = await axios.get(tileUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': this.userAgent
          },
          timeout: 10000
        });
        
        // Rotate to next server for load balancing
        this.currentServerIndex = (this.currentServerIndex + 1) % this.osmServers.length;
        
        return Buffer.from(response.data);
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt + 1} failed for tile ${z}/${x}/${y}:`, error.message);
        
        // Try next server on failure
        this.currentServerIndex = (this.currentServerIndex + 1) % this.osmServers.length;
        
        if (attempt < retries - 1) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    
    throw lastError;
  }
  
  // Preload single tile directly from OSM to cache
  async preloadTileDirectly(z, x, y) {
    try {
      // Check if already cached
      if (await this.isTileCached(z, x, y)) {
        return { success: true, source: 'cache', message: 'Already cached' };
      }
      
      // Download from OSM
      const tileBuffer = await this.downloadTileFromOSM(z, x, y);
      if (!tileBuffer) {
        return { success: false, error: 'Failed to download from OSM' };
      }
      
      // Save to cache
      const saved = await this.saveTileToCache(z, x, y, tileBuffer, {
        downloadedAt: Date.now(),
        source: 'osm-direct',
        preloaded: true
      });
      
      return {
        success: saved,
        source: 'osm',
        message: saved ? 'Downloaded and cached' : 'Failed to save to cache'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // Get tile (from cache or download)
  async getTile(z, x, y, forceDownload = false) {
    try {
      // Check cache first (unless forced download)
      if (!forceDownload && await this.isTileCached(z, x, y)) {
        console.log(`📦 Tile ${z}/${x}/${y} found in cache`);
        const cachedTile = await this.loadTileFromCache(z, x, y);
        if (cachedTile) {
          return { tile: cachedTile, source: 'cache' };
        }
      }
      
      // Tile not in cache or force download - get from OSM
      console.log(`📥 Tile ${z}/${x}/${y} not in cache, downloading from OSM...`);
      const tile = await this.downloadTileFromOSM(z, x, y);
      
      // Save to persistent cache
      console.log(`💾 Saving tile ${z}/${x}/${y} to persistent cache...`);
      await this.saveTileToCache(z, x, y, tile);
      
      return { tile, source: 'download' };
    } catch (error) {
      console.error(`Failed to get tile ${z}/${x}/${y}:`, error.message);
      throw error;
    }
  }
  
  // Calculate tiles for bounds at specific zoom level
  getTilesForBounds(bounds, zoom) {
    const tiles = [];
    
    // Convert geo bounds to tile coordinates
    const tileSize = 256;
    const worldSize = tileSize * Math.pow(2, zoom);
    
    function lonToTileX(lon, zoom) {
      return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    }
    
    function latToTileY(lat, zoom) {
      return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    }
    
    const minX = lonToTileX(bounds.minLon, zoom);
    const maxX = lonToTileX(bounds.maxLon, zoom);
    const minY = latToTileY(bounds.maxLat, zoom);
    const maxY = latToTileY(bounds.minLat, zoom);
    
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push({ z: zoom, x, y });
      }
    }
    
    return tiles;
  }
  
  // Direct preload tiles from OSM servers (bypassing local server)
  async preloadTilesDirectly(zoomLevels = [10, 11, 12, 13], bounds = null) {
    const targetBounds = bounds || this.westJavaBounds;
    const results = {
      totalTiles: 0,
      downloadedTiles: 0,
      cachedTiles: 0,
      failedTiles: 0,
      startTime: Date.now(),
      progress: {}
    };
    
    console.log(`🔄 Starting direct tile preload for zoom levels: ${zoomLevels.join(', ')}`);
    console.log(`📍 Bounds: ${JSON.stringify(targetBounds)}`);
    console.log(`🌍 Direct download from OSM servers`);
    
    for (const zoom of zoomLevels) {
      const tiles = this.getTilesForBounds(targetBounds, zoom);
      results.totalTiles += tiles.length;
      results.progress[zoom] = { total: tiles.length, completed: 0, failed: 0 };
      
      console.log(`📦 Zoom ${zoom}: ${tiles.length} tiles to process`);
      
      // Process tiles in smaller batches for direct OSM download
      const batchSize = 3; // Smaller batch for direct OSM to avoid rate limiting
      for (let i = 0; i < tiles.length; i += batchSize) {
        const batch = tiles.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (tile) => {
          try {
            // Check if tile already exists in cache
            if (await this.isTileCached(tile.z, tile.x, tile.y)) {
              results.cachedTiles++;
              results.progress[zoom].completed++;
              return { success: true, source: 'cache' };
            }
            
            // Download directly from OSM
            const tileBuffer = await this.downloadTileFromOSM(tile.z, tile.x, tile.y);
            if (tileBuffer) {
              // Save directly to cache
              const saved = await this.saveTileToCache(tile.z, tile.x, tile.y, tileBuffer, {
                downloadedAt: Date.now(),
                source: 'osm-direct',
                server: this.osmServers[this.currentServerIndex]
              });
              
              if (saved) {
                results.downloadedTiles++;
              } else {
                results.failedTiles++;
                results.progress[zoom].failed++;
              }
            } else {
              results.failedTiles++;
              results.progress[zoom].failed++;
            }
            
            results.progress[zoom].completed++;
            
            // Log progress every 10 tiles
            if (results.progress[zoom].completed % 10 === 0) {
              const percent = Math.round((results.progress[zoom].completed / results.progress[zoom].total) * 100);
              console.log(`   📊 Zoom ${zoom}: ${results.progress[zoom].completed}/${results.progress[zoom].total} (${percent}%)`);
            }
          } catch (error) {
            results.failedTiles++;
            results.progress[zoom].failed++;
            console.warn(`❌ Failed to download tile ${tile.z}/${tile.x}/${tile.y}:`, error.message);
          }
        });
        
        await Promise.allSettled(batchPromises);
        
        // Rate limiting - wait between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`✅ Zoom ${zoom} completed: ${results.progress[zoom].completed - results.progress[zoom].failed} success, ${results.progress[zoom].failed} failed`);
    }
    
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    
    console.log(`🎉 Preload completed!`);
    console.log(`   📊 Total: ${results.totalTiles} tiles`);
    console.log(`   💾 Downloaded: ${results.downloadedTiles}`);
    console.log(`   🔄 From cache: ${results.cachedTiles}`);
    console.log(`   ❌ Failed: ${results.failedTiles}`);
    console.log(`   ⏱️  Duration: ${Math.round(results.duration / 1000)}s`);
    
    return results;
  }
  
  // Get cache statistics
  async getCacheStatistics() {
    try {
      const stats = { 
        totalTiles: 0, 
        totalSize: 0, 
        totalSizeMB: 0,
        zoomLevels: {},
        oldestTile: null,
        newestTile: null
      };
      
      const tilesDir = path.join(this.cacheDir, 'tiles');
      if (!fsSync.existsSync(tilesDir)) {
        return stats;
      }
      
      const zoomDirs = await fs.readdir(tilesDir);
      
      for (const zoomDir of zoomDirs) {
        const z = parseInt(zoomDir);
        if (isNaN(z)) continue;
        
        stats.zoomLevels[z] = 0;
        
        const zoomPath = path.join(tilesDir, zoomDir);
        if (!(await fs.stat(zoomPath)).isDirectory()) continue;
        
        const xDirs = await fs.readdir(zoomPath);
        
        for (const xDir of xDirs) {
          const xPath = path.join(zoomPath, xDir);
          if (!(await fs.stat(xPath)).isDirectory()) continue;
          
          const yFiles = await fs.readdir(xPath);
          
          for (const yFile of yFiles) {
            if (yFile.endsWith('.png')) {
              const filePath = path.join(xPath, yFile);
              const fileStat = await fs.stat(filePath);
              
              stats.totalTiles++;
              stats.totalSize += fileStat.size;
              stats.zoomLevels[z]++;
              
              // Track oldest/newest tiles
              const mtime = fileStat.mtime.getTime();
              if (!stats.oldestTile || mtime < stats.oldestTile.time) {
                stats.oldestTile = { 
                  time: mtime, 
                  path: filePath.replace(this.cacheDir, ''),
                  date: fileStat.mtime.toISOString()
                };
              }
              if (!stats.newestTile || mtime > stats.newestTile.time) {
                stats.newestTile = { 
                  time: mtime, 
                  path: filePath.replace(this.cacheDir, ''),
                  date: fileStat.mtime.toISOString()
                };
              }
            }
          }
        }
      }
      
      stats.totalSizeMB = Math.round(stats.totalSize / (1024 * 1024) * 100) / 100;
      return stats;
    } catch (error) {
      console.error('Error getting cache statistics:', error.message);
      return { totalTiles: 0, totalSize: 0, totalSizeMB: 0, zoomLevels: {} };
    }
  }
  
  // Manual cache management - only clean when explicitly requested
  async cleanCache(type = 'all') {
    let cleaned = 0;
    
    try {
      const tilesDir = path.join(this.cacheDir, 'tiles');
      const metaDir = path.join(this.cacheDir, 'metadata');
      
      if (type === 'all') {
        // Remove all cache files
        console.log('🧹 Cleaning entire cache...');
        
        if (fsSync.existsSync(tilesDir)) {
          await fs.rm(tilesDir, { recursive: true, force: true });
          fsSync.mkdirSync(tilesDir, { recursive: true });
        }
        
        if (fsSync.existsSync(metaDir)) {
          await fs.rm(metaDir, { recursive: true, force: true });
          fsSync.mkdirSync(metaDir, { recursive: true });
        }
        
        console.log('🧹 All cache files removed');
        return { message: 'All cache cleared', type: 'all' };
      }
      
      // For specific cleaning, walk through files
      const walkDir = async (dir, callback) => {
        if (!fsSync.existsSync(dir)) return;
        const items = await fs.readdir(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await walkDir(fullPath, callback);
          } else {
            await callback(fullPath, stat);
          }
        }
      };

      if (type === 'specific') {
        // Only remove files that match specific criteria (can be extended)
        console.log('🧹 Cleaning specific cache entries...');
        // Implementation can be extended for specific tile ranges
      }
      
      console.log(`🧹 Cache cleanup completed (${type})`);
      return { message: `Cache cleanup completed`, type: type, cleaned: cleaned };
    } catch (error) {
      console.error('Error cleaning cache:', error.message);
      return { error: error.message, cleaned: 0 };
    }
  }
  
  // Force update specific tiles (re-download from OSM)
  async updateTiles(bounds, minZoom, maxZoom) {
    console.log('🔄 Force updating tiles from OSM...');
    
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const zoomTiles = this.getTilesForBounds(bounds, z);
      tiles.push(...zoomTiles);
    }
    
    let updated = 0;
    const batchSize = 5;
    
    for (let i = 0; i < tiles.length; i += batchSize) {
      const batch = tiles.slice(i, i + batchSize);
      const batchPromises = batch.map(async (tile) => {
        try {
          const result = await this.getTile(tile.z, tile.x, tile.y, true); // Force download
          if (result.source === 'download') {
            updated++;
          }
          console.log(`🔄 Updated tile ${tile.z}/${tile.x}/${tile.y}`);
        } catch (error) {
          console.warn(`❌ Failed to update tile ${tile.z}/${tile.x}/${tile.y}:`, error.message);
        }
      });
      
      await Promise.allSettled(batchPromises);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
    }
    
    console.log(`✅ Updated ${updated} tiles from OSM`);
    return { updated, total: tiles.length };
  }
}

module.exports = TileCacheManager;