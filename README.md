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

```bash
# Download OSM data Jawa Barat (~180MB)
npm run download-pbf

# Process untuk OSRM (~10-20 menit)
.\scripts\process-osrm.ps1
```

### 3. Start Services

```bash
# Start OSRM backend
docker-compose up -d osrm-backend

# Start API server
npm start
```

### 4. Access

- **Web UI**: http://localhost:8080
- **Health Check**: http://localhost:8080/health

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
PORT=8080
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
curl -X POST http://localhost:8080/cache/preload \
  -H "Content-Type: application/json" \
  -d '{"zoomLevels": [8, 9, 10, 11, 12]}'
```

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
curl http://localhost:8080/cache/stats

# Preload popular zoom levels
curl -X POST http://localhost:8080/cache/preload \
  -d '{"zoomLevels": [10, 11, 12]}'
```

**3. High Disk Usage**

```bash
# Clean old cache (older than 12 hours)
curl -X DELETE "http://localhost:8080/cache/clean?maxAgeHours=12"
```

---

**🗺️ Powered by OpenStreetMap • OSRM • Leaflet 🚀**

_Optimized for Jawa Barat (West Java) region_
