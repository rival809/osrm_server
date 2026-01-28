# 🏠 Self-Hosted Configuration Guide

## 🎯 Tujuan

Service ini sekarang **100% self-hosted** - tidak perlu koneksi ke `tile.openstreetmap.org` atau server eksternal lainnya.

---

## 🔧 Konfigurasi Offline Mode

### **Mode 1: Offline Strict** ✅ (Recommended untuk Production)

**Karakteristik:**

- ✅ **100% Offline** - Tidak download dari internet
- ✅ Hanya serve tiles dari cache lokal
- ❌ Error jika tile belum di-cache
- ✅ Cocok untuk production dengan tiles sudah preload

**Setup:**

```bash
# Edit .env
OFFLINE_MODE=true
TILE_SERVER_URL=
```

**Cara Preload Tiles:**

```bash
# Linux/Mac
./CACHE-MANAGER.sh

# Windows
.\CACHE-MANAGER.ps1

# Pilih option: Start Preload
# Zoom levels recommended: 10, 11, 12, 13, 14
```

---

### **Mode 2: Local Tile Server** 🔄

**Karakteristik:**

- ✅ Tidak kontak OSM servers
- ✅ Download dari tile server lokal Anda
- ✅ Cache untuk akses lebih cepat
- ✅ Cocok jika Anda punya tileserver-gl/martin/tegola

**Setup:**

```bash
# Edit .env
OFFLINE_MODE=false
TILE_SERVER_URL=http://localhost:8000
```

**Tile Server Options:**

- **tileserver-gl**: https://github.com/maptiler/tileserver-gl
- **Martin**: https://github.com/maplibre/martin
- **Tegola**: https://github.com/go-spatial/tegola

---

### **Mode 3: Hybrid** (Development Only)

**Karakteristik:**

- ⚠️ Download dari OSM jika tile tidak ada
- ✅ Auto-cache untuk next request
- ❌ Melanggar usage policy OSM untuk production
- ✅ OK untuk development/testing

**Setup:**

```bash
# Edit .env
OFFLINE_MODE=false
TILE_SERVER_URL=
```

---

## 📋 Deployment Checklist

### Step 1: Clone & Setup

```bash
git clone <repo-url> /opt/osrm_service
cd /opt/osrm_service
cp .env.example .env
```

### Step 2: Edit Environment

```bash
nano .env

# Set:
OFFLINE_MODE=true
OSRM_URL=http://localhost:5000
```

### Step 3: Download OSM Data

```bash
mkdir -p data
cd data
wget http://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
cd ..
```

### Step 4: Process OSRM Data

```bash
# Linux
./scripts/process-osrm-v6.sh

# Windows
.\scripts\process-osrm-v6.ps1
```

### Step 5: Preload Tiles (IMPORTANT!)

```bash
# Linux
./CACHE-MANAGER.sh

# Windows
.\CACHE-MANAGER.ps1

# Pilih: Start Preload
# Zoom: 10-14 (recommended)
# Estimasi waktu: 1-3 jam
# Estimasi size: 2-5GB
```

### Step 6: Install Dependencies

```bash
npm install --production
```

### Step 7: Start Service

**Docker:**

```bash
docker-compose up -d
```

**Manual:**

```bash
# Development
npm start

# Production with PM2
npm install -g pm2
pm2 start src/server.js --name osrm-tile -i 2
```

**Systemd:**

```bash
# Copy service file
sudo cp systemd/osrm-tile.service /etc/systemd/system/
sudo systemctl enable osrm-tile
sudo systemctl start osrm-tile
```

---

## ✅ Verifikasi

### Check Health

```bash
curl http://localhost:8080/health
```

**Expected Response:**

```json
{
  "status": "ok",
  "service": "OSRM Tile Service (Full Local)",
  "mode": "offline-strict",
  "offlineMode": true,
  "tileServer": "OSM (external)",
  "cache": {
    "totalTiles": 45000,
    "totalSizeMB": 2500
  }
}
```

### Check Cache Stats

```bash
curl http://localhost:8080/cache/stats
```

### Test Tile Endpoint

```bash
# Tile harus ada di cache
curl -I http://localhost:8080/tiles/12/3230/1830.png

# HTTP/1.1 200 OK (jika cached)
# HTTP/1.1 500 (jika offline mode dan tidak cached)
```

---

## 🔍 Troubleshooting

### Tile Not Found (Offline Mode)

```
Error: Tile 12/3230/1830 not in cache and OFFLINE_MODE is enabled
```

**Solusi:**

```bash
# Preload tiles dulu
./CACHE-MANAGER.sh
# Pilih: Start Preload
```

### Custom Tile Server Not Working

```bash
# Check tile server running
curl http://localhost:8000/12/3230/1830.png

# Update .env
TILE_SERVER_URL=http://localhost:8000

# Restart service
pm2 restart osrm-tile
```

### Out of Disk Space

```bash
# Check cache size
du -sh cache/

# Clean old cache
./CACHE-MANAGER.sh
# Pilih: Clean Cache

# Atau adjust di .env
MAX_CACHE_SIZE_MB=5000
```

---

## 📊 Resource Requirements

### Minimum (Offline Mode)

- **RAM:** 4GB
- **Disk:** 50GB (10GB OSRM data + 5GB tiles + 35GB free)
- **CPU:** 2 cores

### Recommended (Production)

- **RAM:** 16GB
- **Disk:** 100GB SSD
- **CPU:** 4+ cores

### Tile Cache Size Estimates

| Zoom Levels | Area | Tiles | Size   |
| ----------- | ---- | ----- | ------ |
| 10-12       | Java | ~15K  | ~800MB |
| 10-13       | Java | ~60K  | ~2.5GB |
| 10-14       | Java | ~240K | ~8GB   |
| 10-15       | Java | ~950K | ~25GB  |

---

## 🚀 Production Tips

1. **Preload sebelum deploy** - Jangan biarkan production download on-demand
2. **Monitor disk space** - Cache bisa cepat membesar
3. **Backup cache** - Tiles hasil preload berharga
4. **Nginx caching** - Double layer caching untuk performa
5. **CDN (optional)** - Serve tiles dari CDN untuk global access

---

## 📞 Support

- **Logs:** `./logs/combined.log`
- **Cache Stats:** `http://localhost:8080/cache/stats`
- **Health:** `http://localhost:8080/health`

**Environment Variables:**

- `OFFLINE_MODE` - true/false untuk offline strict
- `TILE_SERVER_URL` - URL tile server lokal
- `MAX_CACHE_SIZE_MB` - Limit ukuran cache
