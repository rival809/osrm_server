# 🗺️ Local Tile Server Setup Guide

## Setup Tile Server dari PBF File Anda

Daripada download dari `tile.openstreetmap.org`, Anda bisa generate tiles dari PBF file sendiri!

---

## 🚀 Quick Start

### **Windows:**

```powershell
# 1. Pastikan Docker Desktop sudah running

# 2. Jalankan automated script
.\scripts\setup-tileserver.ps1

# Script akan otomatis:
# ✅ Convert PBF → MBTiles
# ✅ Start tileserver-gl
# ✅ Update .env configuration
# ✅ Test tile generation
```

### **Ubuntu/Linux:**

```bash
# 1. Pastikan Docker sudah installed

# 2. Jalankan automated script
chmod +x scripts/setup-tileserver.sh
./scripts/setup-tileserver.sh

# Script akan otomatis:
# ✅ Convert PBF → MBTiles
# ✅ Start tileserver-gl
# ✅ Update .env configuration
# ✅ Test tile generation
```

---

## 📋 Apa yang Dilakukan Script?

### **Step 1: Check Requirements**

- ✅ Docker installed & running
- ✅ PBF file exists (`data/java-latest.osm.pbf`)

### **Step 2: Convert PBF → MBTiles**

```bash
# Menggunakan tilemaker
docker run ghcr.io/systemed/tilemaker:latest \
  --input /data/java-latest.osm.pbf \
  --output /data/java.mbtiles

# Output: data/java.mbtiles (~300-800MB)
# Waktu: 10-30 menit
```

### **Step 3: Start Tileserver**

```bash
docker run -d \
  --name osrm-tileserver \
  -p 5001:8080 \
  -v ./data:/data:ro \
  maptiler/tileserver-gl \
  --mbtiles /data/java.mbtiles
```

### **Step 4: Update Configuration**

```bash
# Otomatis update .env:
OFFLINE_MODE=false
TILE_SERVER_URL=http://localhost:5001/styles/basic-preview
```

### **Step 5: Test**

```bash
# Test tile generation
curl http://localhost:5001/styles/basic-preview/12/3230/1830.png
```

---

## 🎯 Setelah Setup

### **Start OSRM Service:**

```bash
# Service akan otomatis gunakan local tile server
npm start

# Check health
curl http://localhost:8080/health
```

### **Test Tile Endpoint:**

```bash
# Request tile → generated dari PBF Anda
curl http://localhost:8080/tiles/12/3230/1830.png -o test.png

# First request: slower (generating)
# Next request: fast (cached)
```

---

## 🔍 Monitoring

### **Check Tileserver Status:**

```bash
# Windows
docker ps | findstr osrm-tileserver

# Linux
docker ps | grep osrm-tileserver
```

### **View Logs:**

```bash
docker logs -f osrm-tileserver
```

### **Stop/Start:**

```bash
# Stop
docker stop osrm-tileserver

# Start
docker start osrm-tileserver

# Restart
docker restart osrm-tileserver
```

---

## 🌐 Access Tile Server

### **Viewer (Web UI):**

```
http://localhost:5001
```

### **Tile URL Pattern:**

```
http://localhost:5001/styles/basic-preview/{z}/{x}/{y}.png
```

### **Example Tiles:**

```bash
# Jakarta area
http://localhost:5001/styles/basic-preview/12/3230/1830.png

# Surabaya area
http://localhost:5001/styles/basic-preview/12/3280/1850.png
```

---

## ⚙️ Advanced Configuration

### **Use with Docker Compose:**

```bash
# Start all services (OSRM + Tileserver)
docker-compose -f docker-compose.tileserver.yml up -d

# Check services
docker-compose -f docker-compose.tileserver.yml ps

# View logs
docker-compose -f docker-compose.tileserver.yml logs -f
```

### **Custom Port:**

```bash
# Edit script before running
$TileserverPort = 9000  # Windows
TileserverPort=9000     # Linux

# Or run manually:
docker run -d \
  --name osrm-tileserver \
  -p 9000:8080 \
  -v ./data:/data:ro \
  maptiler/tileserver-gl \
  --mbtiles /data/java.mbtiles

# Update .env
TILE_SERVER_URL=http://localhost:9000/styles/basic-preview
```

---

## 🛠️ Troubleshooting

### **Docker not running:**

```bash
# Windows: Start Docker Desktop
# Linux:
sudo systemctl start docker
```

### **PBF file not found:**

```bash
# Download Java Island PBF
mkdir -p data
cd data
wget http://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
```

### **Conversion failed:**

```bash
# Check disk space
df -h  # Linux
Get-PSDrive C | Select-Object Used,Free  # Windows

# Need at least 5GB free space
```

### **Tile generation failed:**

```bash
# Check logs
docker logs osrm-tileserver

# Common issue: MBTiles corrupted
# Solution: Delete and re-convert
rm data/java.mbtiles
./scripts/setup-tileserver.sh  # Regenerate
```

### **Port already in use:**

```bash
# Check what's using port 5001
# Windows:
netstat -ano | findstr :5001

# Linux:
lsof -i :5001

# Kill process or use different port
```

---

## 📊 Performance

### **First Tile Request:**

- Time: 100-300ms (generating)
- CPU: High (rendering)

### **Cached Tile Request:**

- Time: 5-20ms (from cache)
- CPU: Low

### **Disk Usage:**

```
PBF file:     ~400MB
MBTiles:      ~600MB
Tile cache:   ~2GB (grows over time)
Total:        ~3GB
```

---

## 💡 Tips

1. **Preload Popular Areas** - Request tiles untuk area yang sering diakses
2. **Nginx Caching** - Double layer caching untuk performa maksimal
3. **Resource Limits** - Set Docker memory limit jika perlu
4. **Regular Updates** - Update PBF & regenerate MBTiles monthly

---

## 🎉 Benefits

✅ **100% Self-Hosted** - No dependency ke OSM servers  
✅ **Fast** - Local generation, no network latency  
✅ **Custom Data** - Use your own PBF data  
✅ **Production Ready** - Stable & reliable  
✅ **Easy Setup** - Automated scripts

---

## 📞 Support

**Logs:**

- Tileserver: `docker logs osrm-tileserver`
- OSRM Service: `./logs/combined.log`

**Status:**

- Health: `http://localhost:5001/health`
- Service: `http://localhost:8080/health`
