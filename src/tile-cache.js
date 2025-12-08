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
    this.logger = options.logger || console; // Use provided logger or fallback to console
    this.osrmDataPath = options.osrmDataPath || './data/java-latest.osrm.timestamp';
    
    this.logger.info('TileCacheManager constructor started');
    
    // Java island bounds (full coverage)
    this.westJavaBounds = {
      minLon: 105.0,
      minLat: -8.8,
      maxLon: 114.0,
      maxLat: -5.9
    };
    
    this.logger.info('Calling initializeCacheDirectories...');
    this.initializeCacheDirectories();
    this.checkOSRMDataTimestamp();
    this.logger.info('TileCacheManager constructor completed');
  }
  
  // Initialize cache directory structure
  initializeCacheDirectories() {
    this.logger.info('initializeCacheDirectories: Started');
    const dirs = [
      this.cacheDir,
      path.join(this.cacheDir, 'tiles'),
      path.join(this.cacheDir, 'metadata'),
      path.join(this.cacheDir, 'preload')
    ];
    
    this.logger.info(`initializeCacheDirectories: Creating ${dirs.length} directories`);
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      this.logger.info(`initializeCacheDirectories: Checking dir [${i}]: ${dir}`);
      if (!fsSync.existsSync(dir)) {
        this.logger.info(`initializeCacheDirectories: Creating dir [${i}]: ${dir}`);
        fsSync.mkdirSync(dir, { recursive: true });
        this.logger.info(`initializeCacheDirectories: Created dir [${i}]: ${dir}`);
      } else {
        this.logger.info(`initializeCacheDirectories: Dir [${i}] exists: ${dir}`);
      }
    }
    this.logger.info('initializeCacheDirectories: Completed');
  }
  
  // Check if OSRM data has been rebuilt (auto-clear cache if needed)
  checkOSRMDataTimestamp() {
    try {
      const cacheTimestampFile = path.join(this.cacheDir, '.osrm-data-timestamp');
      
      if (fsSync.existsSync(this.osrmDataPath)) {
        const osrmDataStats = fsSync.statSync(this.osrmDataPath);
        const osrmDataTime = osrmDataStats.mtime.getTime();
        
        // Check if cache timestamp exists
        if (fsSync.existsSync(cacheTimestampFile)) {
          const cacheTimestamp = parseInt(fsSync.readFileSync(cacheTimestampFile, 'utf8'));
          
          // If OSRM data is newer than cache, clear cache
          if (osrmDataTime > cacheTimestamp) {
            this.logger.info('🔄 OSRM data has been rebuilt, clearing tile cache...');
            this.clearAllCache();
            fsSync.writeFileSync(cacheTimestampFile, osrmDataTime.toString());
            this.logger.info('✅ Tile cache cleared and timestamp updated');
          } else {
            this.logger.info('✅ Tile cache is up-to-date with OSRM data');
          }
        } else {
          // First time, just save timestamp
          fsSync.writeFileSync(cacheTimestampFile, osrmDataTime.toString());
          this.logger.info('📝 OSRM data timestamp saved');
        }
      } else {
        this.logger.warn('⚠️  OSRM timestamp file not found, skipping cache validation');
      }
    } catch (error) {
      this.logger.error('Error checking OSRM data timestamp:', error);
    }
  }
  
  // Clear all cached tiles
  clearAllCache() {
    try {
      const tilesDir = path.join(this.cacheDir, 'tiles');
      if (fsSync.existsSync(tilesDir)) {
        fsSync.rmSync(tilesDir, { recursive: true, force: true });
        fsSync.mkdirSync(tilesDir, { recursive: true });
        this.logger.info('🧹 All tile cache cleared');
      }
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }
  
  // Check if tile is an "Outside Java Island" tile by detecting unique marker
  isOutsideJavaTile(tileBuffer) {
    try {
      // Quick check - fallback PNG is exactly 103 bytes
      if (tileBuffer.length === 103) {
        return true;
      }
      
      // Check for PNG signature
      if (tileBuffer.length < 8 || 
          tileBuffer[0] !== 0x89 || tileBuffer[1] !== 0x50 || 
          tileBuffer[2] !== 0x4E || tileBuffer[3] !== 0x47) {
        return false;
      }
      
      // For canvas-generated tiles, check for magenta marker at position (255,255)
      // This is a simple heuristic - real implementation would need PNG parsing
      // For now, we rely on size check: Outside tiles are ~2.5KB, OSM tiles are >5KB
      if (tileBuffer.length > 1000 && tileBuffer.length < 4000) {
        // Likely an error/outside tile (canvas-generated ~2-3KB)
        // Check if it contains "Outside" text marker in raw bytes
        const textCheck = tileBuffer.toString('utf8', 0, Math.min(tileBuffer.length, 1000));
        if (textCheck.includes('Outside') || textCheck.includes('Java Island')) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
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
      this.logger.error(`Error saving tile ${z}/${x}/${y} to cache:`, { error: error.message, stack: error.stack });
      return false;
    }
  }
  
  // Get tile - check cache first, then download from OSM
  async getTile(z, x, y) {
    try {
      // Check if tile is cached
      if (await this.isTileCached(z, x, y)) {
        const tile = await this.loadTileFromCache(z, x, y);
        if (tile) {
          // Validate tile - check if it's an "Outside Java Island" tile
          const MIN_VALID_TILE_SIZE = 500; // bytes - normal OSM tiles are usually > 5KB
          const isOutsideTile = this.isOutsideJavaTile(tile);
          
          if (tile.length < MIN_VALID_TILE_SIZE || isOutsideTile) {
            const reason = isOutsideTile ? 'Outside Java Island marker detected' : `too small (${tile.length} bytes)`;
            this.logger.warn(`Cached tile ${z}/${x}/${y} is invalid (${reason}), re-downloading...`);
            
            // Delete invalid cached tile
            const tilePath = this.getTileCachePath(z, x, y);
            const metaPath = this.getTileMetadataPath(z, x, y);
            try {
              const fs = require('fs').promises;
              await fs.unlink(tilePath).catch(() => {});
              await fs.unlink(metaPath).catch(() => {});
            } catch (e) {
              // Ignore delete errors
            }
            // Fall through to download section below
          } else {
            this.logger.debug(`Tile ${z}/${x}/${y} loaded from cache (${tile.length} bytes)`);
            return { tile, source: 'cache' };
          }
        }
      }

      // Download from OSM with retry
      this.logger.info(`Downloading tile ${z}/${x}/${y} from OSM`);
      const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      
      let lastError;
      for (let retry = 0; retry < 3; retry++) {
        try {
          if (retry > 0) {
            this.logger.info(`Retry ${retry}/3 for tile ${z}/${x}/${y}`);
            await new Promise(resolve => setTimeout(resolve, retry * 1000)); // Backoff
          }
          
          const response = await axios.get(tileUrl, {
            responseType: 'arraybuffer',
            timeout: 30000, // Increased to 30 seconds
            headers: {
              'User-Agent': 'OSRM-Tile-Service/1.0'
            }
          });

          const tileBuffer = Buffer.from(response.data);
          this.logger.info(`Tile ${z}/${x}/${y} downloaded successfully (${tileBuffer.length} bytes)`);

          // Save to cache
          await this.saveTileToCache(z, x, y, tileBuffer, { 
            source: 'osm',
            downloadedAt: new Date().toISOString()
          });

          return { tile: tileBuffer, source: 'download' };
        } catch (err) {
          lastError = err;
          this.logger.warn(`Download attempt ${retry + 1} failed for tile ${z}/${x}/${y}: ${err.message}`);
        }
      }
      
      throw lastError;
    } catch (error) {
      this.logger.error(`Error getting tile ${z}/${x}/${y}:`, { 
        error: error.message, 
        stack: error.stack 
      });
      throw error;
    }
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
}

module.exports = TileCacheManager;