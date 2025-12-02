/**
 * Memory Monitoring and Leak Detection
 * Production-ready memory management
 */

const logger = require('./logger');

class MemoryMonitor {
  constructor(options = {}) {
    this.interval = options.interval || 30000; // 30 seconds
    this.maxMemoryMB = options.maxMemoryMB || 10000; // 10GB
    this.warningThresholdPercent = options.warningThresholdPercent || 80;
    this.criticalThresholdPercent = options.criticalThresholdPercent || 90;
    
    this.isMonitoring = false;
    this.memoryHistory = [];
    this.maxHistoryLength = 100; // Keep last 100 readings
  }

  start() {
    if (this.isMonitoring) {
      logger.warn('Memory monitor already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting memory monitor...');
    
    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.interval);

    // Initial memory check
    this.checkMemory();
  }

  stop() {
    if (!this.isMonitoring) {
      return;
    }

    clearInterval(this.intervalId);
    this.isMonitoring = false;
    logger.info('Memory monitor stopped');
  }

  checkMemory() {
    const usage = process.memoryUsage();
    const timestamp = Date.now();
    
    // Convert to MB
    const memoryMB = {
      rss: Math.round(usage.rss / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024)
    };

    // Calculate percentage of max memory
    const memoryPercent = (memoryMB.rss / this.maxMemoryMB) * 100;

    // Add to history
    this.memoryHistory.push({
      timestamp,
      ...memoryMB,
      percent: memoryPercent
    });

    // Keep history size manageable
    if (this.memoryHistory.length > this.maxHistoryLength) {
      this.memoryHistory.shift();
    }

    // Check thresholds and log appropriately
    if (memoryPercent >= this.criticalThresholdPercent) {
      logger.error(`CRITICAL: Memory usage at ${memoryPercent.toFixed(1)}% (${memoryMB.rss}MB)`, {
        memory: memoryMB,
        threshold: 'critical'
      });
      
      // Force garbage collection if available
      if (global.gc) {
        logger.info('Forcing garbage collection...');
        global.gc();
      }
      
    } else if (memoryPercent >= this.warningThresholdPercent) {
      logger.warn(`WARNING: Memory usage at ${memoryPercent.toFixed(1)}% (${memoryMB.rss}MB)`, {
        memory: memoryMB,
        threshold: 'warning'
      });
    } else {
      logger.debug(`Memory usage: ${memoryPercent.toFixed(1)}% (${memoryMB.rss}MB)`, {
        memory: memoryMB
      });
    }

    // Detect potential memory leaks
    this.detectMemoryLeak();
  }

  detectMemoryLeak() {
    if (this.memoryHistory.length < 10) return;

    // Get last 10 readings
    const recent = this.memoryHistory.slice(-10);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    // Check for consistent upward trend
    const growthMB = newest.rss - oldest.rss;
    const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / 1000 / 60;
    const growthRateMBPerMinute = growthMB / timeDiffMinutes;

    // Alert if growing more than 5MB per minute consistently
    if (growthRateMBPerMinute > 5) {
      logger.warn(`Potential memory leak detected: ${growthRateMBPerMinute.toFixed(2)}MB/min growth rate`, {
        growth: {
          totalMB: growthMB,
          timeMinutes: timeDiffMinutes,
          rateMBPerMinute: growthRateMBPerMinute
        }
      });
    }
  }

  getMemoryStats() {
    const current = process.memoryUsage();
    const currentMB = {
      rss: Math.round(current.rss / 1024 / 1024),
      heapUsed: Math.round(current.heapUsed / 1024 / 1024),
      heapTotal: Math.round(current.heapTotal / 1024 / 1024),
      external: Math.round(current.external / 1024 / 1024)
    };

    const memoryPercent = (currentMB.rss / this.maxMemoryMB) * 100;

    return {
      current: currentMB,
      percent: memoryPercent,
      maxMemoryMB: this.maxMemoryMB,
      warningThreshold: this.warningThresholdPercent,
      criticalThreshold: this.criticalThresholdPercent,
      history: this.memoryHistory.slice(-20), // Last 20 readings
      isMonitoring: this.isMonitoring
    };
  }

  // Force cleanup
  async cleanup() {
    logger.info('Forcing memory cleanup...');
    
    if (global.gc) {
      global.gc();
      logger.info('Garbage collection forced');
    } else {
      logger.warn('Garbage collection not available. Start with --expose-gc flag.');
    }

    // Wait a bit and check if cleanup helped
    setTimeout(() => {
      this.checkMemory();
    }, 1000);
  }
}

module.exports = MemoryMonitor;