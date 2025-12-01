# 🗺️ OSRM Tile Service - Jawa Barat

Service routing dan tile server untuk wilayah Jawa Barat dengan **lokal routing** dan **smart tile caching** dari OpenStreetMap.

## 🌟 Konsep & Fitur

### **1. Lokal Routing**

- Routing engine OSRM berjalan lokal (tidak tergantung internet)
- Data OSM Jawa Barat diproses untuk routing mobil
- Response cepat dan reliable

### **2. Smart Tile Caching**

- **Preload**: Download tiles secara batch untuk area Jawa Barat
- **Smart Serving**:
  - ✅ Cache hit → serve langsung dari file (~5ms)
  - ❌ Cache miss → download dari OSM → simpan → serve
- **Persistent Storage**: Tiles disimpan di filesystem
- **Auto Management**: TTL, cleanup, statistics

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Download & Process Data

**Automated Download (Recommended):**

```bash
# Download OSM data Jawa Barat (~180MB)
npm run download-pbf

# Process untuk OSRM (~10-20 menit)
.\scripts\process-osrm.ps1
```

**Manual Download:**

```bash
# 1. Download from Geofabrik manually
# URL: https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
# Save to: data/java-latest.osm.pbf

# 2. Or use wget/curl:
wget -O data/java-latest.osm.pbf https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf

# Windows (PowerShell):
Invoke-WebRequest -Uri "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf" -OutFile "data/java-latest.osm.pbf"

# 3. Then process OSRM data
.\scripts\process-osrm-v6.ps1    # Windows
./scripts/process-osrm-v6.sh     # Linux
```

### 3. Start Services

```bash
# Start OSRM backend
docker-compose up -d osrm-backend

# Start API server
npm start
```

### 4. Access

- **Web UI**: http://localhost:3000
- **Health Check**: http://localhost:3000/health

## 🚀 Server Deployment

### **Linux/Unix Servers**

```bash
# 1. Set execute permissions for all scripts
chmod +x *.sh scripts/*.sh

# 2. Complete automated setup
./COMPLETE-SETUP.sh

# Or manual step-by-step:
./scripts/download-pbf.sh       # Download OSM data
./scripts/process-osrm-v6.sh    # Process OSRM data
./START.sh                      # Start all services
```

### **Windows Servers**

```powershell
# Complete automated setup
.\COMPLETE-SETUP.ps1

# Or manual step-by-step:
.\scripts\download-pbf.ps1      # Download OSM data
.\scripts\process-osrm-v6.ps1   # Process OSRM data
.\START.ps1                     # Start all services
```

### **Production Setup**

```bash
# With process manager (recommended)
npm install -g pm2
pm2 start src/server.js --name "osrm-service"
pm2 startup && pm2 save

# Check status
curl http://localhost:3000/health
```

## 📡 API Endpoints

### Core Services

```bash
# Health check
GET /health

# Map tiles (with smart caching)
GET /tiles/{z}/{x}/{y}.png

# Routing (Jawa Barat only)
GET /route?start=107.6191,-6.9175&end=107.6098,-6.9145

# Geocoding (search locations)
GET /geocode?q=Bandung
```

### Cache Management

```bash
# Cache statistics
GET /cache/stats

# Start tile preload
POST /cache/preload
{
  "zoomLevels": [10, 11, 12, 13]
}

# Clean old cache
DELETE /cache/clean?maxAgeHours=24
```

## ⚙️ Configuration

Create `.env` file:

```bash
# Server
PORT=3000
NODE_ENV=development

# OSRM
OSRM_URL=http://localhost:5000

# Cache settings
CACHE_DIR=./cache
CACHE_MODE=smart                 # smart, preload, proxy
PRELOAD_ENABLED=false           # Auto preload on startup
TILE_CACHE_TTL=86400000         # 24 hours (milliseconds)
MAX_CACHE_SIZE_MB=1000          # 1GB cache limit
```

## 🗂️ File Structure

```
osrm_service/
├── data/                    # OSM & OSRM data
│   ├── java-latest.osm.pbf  # OSM data Jawa Barat
│   └── java-latest.osrm*    # OSRM processed files
├── cache/                   # Tile cache (persistent)
│   ├── tiles/               # PNG tile files
│   │   ├── {zoom}/
│   │   │   ├── {x}/
│   │   │   │   └── {y}.png
│   └── metadata/            # Cache metadata + TTL
├── src/
│   ├── server.js           # Main API server
│   └── tile-cache.js       # Cache management class
├── public/
│   └── index.html          # Web demo UI
└── scripts/                # Setup & management scripts
```

## 💾 Cache Management

### Interactive Cache Manager

```bash
# PowerShell interactive menu
.\CACHE-MANAGER.ps1

# atau via npm
npm run cache-manager
```

**Features:**

- 📊 View cache statistics
- 🔄 Start tile preload (default/custom zoom)
- 🧹 Clean old cache entries
- 🚀 Start/stop server

### Manual Cache Operations

```bash
# View cache stats
npm run cache-stats

# Quick preload zoom 10-12
npm run preload

# Custom preload via API
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{"zoomLevels": [8, 9, 10, 11, 12]}'
```

## 📥 Manual Tile Preload Guide

### **Method 1: API Endpoints**

**Quick Preload (Development):**

```bash
# Preload zoom 10-12 (~520MB) - Good for development
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{"zoomLevels": [10, 11, 12]}'
```

**Production Preload:**

```bash
# Preload zoom 8-13 (~2.5GB) - Recommended for production
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{"zoomLevels": [8, 9, 10, 11, 12, 13]}'
```

**Custom Area Preload:**

```bash
# Preload specific bounding box
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{
    "bounds": {
      "minLat": -6.9,
      "maxLat": -6.1,
      "minLng": 107.5,
      "maxLng": 107.7
    },
    "zoomLevels": [12, 13, 14]
  }'
```

### **Method 2: Interactive Cache Manager**

**Linux/macOS:**

```bash
# Set permissions first
chmod +x CACHE-MANAGER.sh

# Run interactive manager
./CACHE-MANAGER.sh
```

**Windows:**

```powershell
# Run interactive manager
.\CACHE-MANAGER.ps1
```

**Menu Options:**

- `1` - View cache statistics
- `2` - Preload default zooms (10-13)
- `3` - Preload custom zoom levels
- `4` - Manual update tiles (specific area)
- `5` - Clean cache

### **Method 3: Batch Download Script**

Create custom preload script:

```bash
#!/bin/bash
# preload-tiles.sh

echo "🚀 Starting tile preload..."

# Bandung area
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{
    "bounds": {
      "minLat": -6.95,
      "maxLat": -6.85,
      "minLng": 107.55,
      "maxLng": 107.65
    },
    "zoomLevels": [10, 11, 12, 13, 14]
  }'

# Jakarta area
curl -X POST http://localhost:3000/cache/preload \
  -H "Content-Type: application/json" \
  -d '{
    "bounds": {
      "minLat": -6.3,
      "maxLat": -6.0,
      "minLng": 106.7,
      "maxLng": 107.0
    },
    "zoomLevels": [10, 11, 12, 13, 14]
  }'

echo "✅ Preload completed!"
```

### **Method 4: PowerShell Batch Script**

```powershell
# preload-tiles.ps1
Write-Host "🚀 Starting tile preload..." -ForegroundColor Cyan

# Bandung area
$bandungData = @{
    bounds = @{
        minLat = -6.95
        maxLat = -6.85
        minLng = 107.55
        maxLng = 107.65
    }
    zoomLevels = @(10, 11, 12, 13, 14)
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "http://localhost:3000/cache/preload" `
    -Method POST -Body $bandungData -ContentType "application/json"

Write-Host "✅ Preload completed!" -ForegroundColor Green
```

### **Monitoring Preload Progress**

```bash
# Check cache stats during preload
watch -n 2 'curl -s http://localhost:3000/cache/stats | jq'

# Windows PowerShell
while ($true) {
    Clear-Host
    Invoke-RestMethod -Uri "http://localhost:3000/cache/stats"
    Start-Sleep 2
}
```

### **Preload Recommendations**

| Use Case        | Zoom Levels | Tiles Count | Size    | Time      |
| --------------- | ----------- | ----------- | ------- | --------- |
| **Development** | 10-12       | ~13K tiles  | ~520 MB | ~10 min   |
| **Production**  | 8-13        | ~65K tiles  | ~2.5 GB | ~45 min   |
| **High Detail** | 8-15        | ~1M+ tiles  | ~30+ GB | ~8+ hours |
| **City Focus**  | 12-16       | ~500K tiles | ~15 GB  | ~4 hours  |

## 📊 Cache Storage Estimates

| Zoom Level | Tiles (Jawa Barat) | Size    | Use Case             |
| ---------- | -----------------: | ------- | -------------------- |
| 8-10       |       ~1,050 tiles | ~40 MB  | Overview             |
| 10-12      |      ~13,800 tiles | ~520 MB | **Recommended Dev**  |
| 8-13       |      ~65,000 tiles | ~2.5 GB | **Recommended Prod** |
| 8-15       |         ~1M+ tiles | ~30+ GB | Full Detail          |

## 🔄 How Tiles Work

```
User Request: GET /tiles/10/512/384.png
     ↓
[1] Check local cache: cache/tiles/10/512/384.png
     ↓
[2] Cache HIT? → Serve file directly (⚡ ~5ms)
     ↓
[3] Cache MISS? → Download from OSM
     ↓
[4] Save to: cache/tiles/10/512/384.png
     ↓
[5] Serve to user from saved file
```

## 🛠️ Development Scripts

```bash
# Data management
npm run download-pbf         # Download OSM data
.\scripts\process-osrm.ps1   # Process OSRM data

# Server
npm start                    # Start API server
npm run dev                  # Start with nodemon

# Cache management
npm run cache-manager        # Interactive cache manager
npm run cache-stats          # Show cache statistics
npm run preload             # Quick preload tiles
```

## 🎯 Usage Scenarios

### **Development Mode**

```bash
# Quick setup for development
CACHE_MODE=smart
PRELOAD_ENABLED=false
# Manual preload zoom 10-12 (~520 MB)
```

### **Production Mode**

```bash
# Optimized for production
CACHE_MODE=smart
PRELOAD_ENABLED=true
# Auto preload zoom 8-13 (~2.5 GB)
```

## 📥 Manual Download Guide

### **Option 1: Direct Browser Download**

1. **Buka browser ke**: https://download.geofabrik.de/asia/indonesia.html
2. **Cari "Java"** di daftar region
3. **Download file**: `java-latest.osm.pbf` (~180MB)
4. **Simpan ke**: `data/java-latest.osm.pbf`

### **Option 2: Command Line**

```bash
# Create data directory
mkdir -p data

# Linux/macOS - using wget
wget -O data/java-latest.osm.pbf https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf

# Linux/macOS - using curl
curl -o data/java-latest.osm.pbf https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf

# Windows PowerShell
New-Item -ItemType Directory -Path "data" -Force
Invoke-WebRequest -Uri "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf" -OutFile "data/java-latest.osm.pbf"
```

### **Option 3: Alternative Sources**

Jika Geofabrik lambat, coba mirror lain:

```bash
# Planet OSM Mirror
curl -o data/java-latest.osm.pbf https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf

# Buka Pustaka Mirror (Indonesia)
wget -O data/java-latest.osm.pbf http://download.openstreetmap.fr/extracts/asia/indonesia/java-latest.osm.pbf
```

### **Verify Download**

```bash
# Check file size (should be ~180MB)
ls -lh data/java-latest.osm.pbf

# Windows
Get-Item data/java-latest.osm.pbf | Select Name, Length

# File should be larger than 150MB
```

### **After Manual Download**

```bash
# Process the downloaded file
# Linux
./scripts/process-osrm-v6.sh

# Windows
.\scripts\process-osrm-v6.ps1
```

## 🐛 Troubleshooting

### Common Issues

**1. OSRM Backend Not Running**

```bash
# Check OSRM status
curl http://localhost:5000/route/v1/driving/106.8,-6.2;107.6,-6.9

# Start OSRM if needed
docker-compose up -d osrm-backend
```

**2. Tiles Loading Slow**

```bash
# Check cache stats
curl http://localhost:3000/cache/stats

# Preload popular zoom levels
curl -X POST http://localhost:3000/cache/preload \
  -d '{"zoomLevels": [10, 11, 12]}'
```

**3. High Disk Usage**

```bash
# Clean old cache (older than 12 hours)
curl -X DELETE "http://localhost:3000/cache/clean?maxAgeHours=12"
```

---

**🗺️ Powered by OpenStreetMap • OSRM • Leaflet 🚀**

_Optimized for Jawa Barat (West Java) region_
