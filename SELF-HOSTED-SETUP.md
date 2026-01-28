# 🏠 Self-Hosted Configuration Guide

## 🎯 Overview

Service ini **100% self-hosted** - tidak perlu koneksi ke `tile.openstreetmap.org` atau server eksternal lainnya.

**Arsitektur:**

```
Local PBF file (java-latest.osm.pbf)
    ├─→ Planetiler → java.mbtiles → Tileserver-GL
    └─→ OSRM tools → java-latest.osrm.* → OSRM Backend

Client → Port 81 (Proxy) → Port 8000 (Tileserver) atau Port 5000 (OSRM)
```

---

## 🔧 Setup Self-Hosted Tileserver

### **Automated Setup (Recommended)**

```powershell
# Windows
.\scripts\setup-tileserver.ps1

# Linux
./scripts/setup-tileserver.sh
```

**Script akan:**

1. ✅ Check Docker running
2. ✅ Verify PBF file exists (`data/java-latest.osm.pbf`)
3. ✅ Convert PBF → MBTiles menggunakan Planetiler
4. ✅ Start tileserver-gl container
5. ✅ Update `.env` configuration
6. ✅ Test tile generation

### **Manual Setup**

**Step 1: Convert PBF to MBTiles**

```bash
docker run -v $(pwd)/data:/data ghcr.io/onthegomap/planetiler:latest \
  --area=indonesia \
  --bounds=105.0,-8.8,114.0,-5.9 \
  --input=/data/java-latest.osm.pbf \
  --output=/data/java.mbtiles
```

**Step 2: Start Tileserver-GL**

```bash
docker run -d \
  --name osrm-tileserver \
  -p 8000:8080 \
  -v $(pwd)/data:/data:ro \
  maptiler/tileserver-gl:latest \
  --mbtiles /data/java.mbtiles
```

**Step 3: Configure Environment**

Edit `.env`:

```bash
TILE_SERVER_URL=http://localhost:8000/styles/basic-preview
```

**Step 4: Test**

```bash
# Test tileserver directly
curl http://localhost:8000/

# Test tile generation
curl http://localhost:8000/styles/basic-preview/13/6544/4253.png -o test.png

# Should return ~50KB PNG file
```

---

## 🌐 Environment Configuration

**Required Variables in `.env`:**

```bash
# Service Port
PORT=81

# OSRM Backend URL
OSRM_URL=http://localhost:5000

# Tileserver URL (REQUIRED for self-hosted)
TILE_SERVER_URL=http://localhost:8000/styles/basic-preview

# Memory limit
MAX_MEMORY_MB=10000
```

**Docker Compose Environment:**

```bash
# Internal Docker network
OSRM_URL=http://osrm-backend:5000
TILE_SERVER_URL=http://tileserver:8080/styles/basic-preview
```

---

## 🚀 Deployment

**Full Stack Deployment:**

```bash
# 1. Ensure data files exist
ls -la data/java-latest.osm.pbf   # PBF file
ls -la data/java.mbtiles           # MBTiles
ls -la data/java-latest.osrm.*     # OSRM files

# 2. Deploy all services
docker compose up -d

# 3. Verify all containers
docker compose ps

# Should see:
# - osrm-tile-service (port 81)
# - osrm-backend (port 5000)
# - tileserver (port 8000)

# 4. Test endpoints
curl http://localhost:81/health
curl http://localhost:81/tiles/13/6544/4253.png -o test.png
```

---

## ✅ Verification Checklist

- [ ] PBF file downloaded (`data/java-latest.osm.pbf`)
- [ ] MBTiles generated (`data/java.mbtiles`)
- [ ] OSRM files processed (`data/java-latest.osrm.*`)
- [ ] All 3 containers running (healthy)
- [ ] Health check returns status "ok"
- [ ] Tiles loading in browser (http://localhost:81)
- [ ] Routing working
- [ ] **No external tile.openstreetmap.org requests**

---

## 🔍 Troubleshooting

**Tileserver not starting:**

```bash
docker logs osrm-tileserver

# Common issues:
# - MBTiles file not found
# - Port 8000 already in use
# - Invalid MBTiles format
```

**Tiles returning 404:**

```bash
# Check tileserver directly
curl http://localhost:8000/

# Check if file mounted correctly
docker exec osrm-tileserver ls -la /data/java.mbtiles

# Restart tileserver
docker compose restart tileserver
```

**Proxy returning errors:**

```bash
# Check proxy logs
docker logs osrm-tile-service

# Verify TILE_SERVER_URL is correct
docker exec osrm-tile-service env | grep TILE_SERVER_URL
```

---

**🗺️ Sekarang 100% Self-Hosted! Tidak ada koneksi ke server eksternal.**
TILE_SERVER_URL=

````

---

## 📋 Deployment Checklist

### Step 1: Clone & Setup

```bash
git clone <repo-url> /opt/osrm_service
cd /opt/osrm_service
cp .env.example .env
````

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
