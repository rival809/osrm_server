# 🗺️ OSRM Tile Service - Java Island

**Full local** routing dan tile server untuk wilayah Java Island dengan **offline routing** dan **persistent tile caching** dari OpenStreetMap.

## 🌟 Konsep & Fitur

### **1. Full Local Routing**
- 🚗 **Complete Offline**: OSRM routing engine berjalan 100% lokal
- 🗺️ **Local Data**: OSM Java Island data diproses untuk routing mobil
- ⚡ **Zero Dependencies**: Response cepat tanpa internet atau external API
- 🔒 **Privacy First**: Tidak ada data yang dikirim ke server external

### **2. Persistent Tile Caching**
- 💾 **Persistent Storage**: Tiles disimpan permanent di filesystem
- 🔄 **Preload Capability**: Download tiles sekali, pakai selamanya
- 🎯 **Smart Serving**:
  - ✅ Cache hit → serve langsung dari file (~5ms)
  - ❌ Cache miss → download dari OSM → simpan → serve
- 🌐 **Direct Method**: Bypass server lokal, langsung OSM → Cache
- 🔧 **Manual Management**: Update tiles hanya ketika diperlukan

### **3. Docker Integration**
- 🐳 **Always Running**: Service cache manager jalan terus di background
- 🔄 **Auto Recovery**: Restart otomatis jika crash
- 📊 **Resource Control**: Memory & CPU limits dengan health checks
- 🚀 **Easy Deployment**: Satu command untuk start semua services

---

# 🖥️ Setup Guide untuk Windows

## 📋 Prerequisites

### **1. Install Docker Desktop**
1. Download dari: https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe
2. Install dengan default settings
3. Restart komputer setelah instalasi
4. Jalankan Docker Desktop dan tunggu sampai running

### **2. Install Node.js**
1. Download dari: https://nodejs.org/en/download/
2. Pilih **LTS version** untuk Windows
3. Install dengan default settings
4. Test di PowerShell:
```powershell
node --version
npm --version
```

### **3. Install Git (Optional)**
1. Download dari: https://git-scm.com/download/win
2. Install dengan default settings

## 🚀 Installation Steps

### **Step 1: Download Project**

**Option A: Via Git Clone**
```powershell
# Clone repository
git clone https://github.com/YOUR-USERNAME/osrm_service.git
cd osrm_service
```

**Option B: Download ZIP**
1. Download project sebagai ZIP
2. Extract ke `d:\Kerja\osrm_service\`
3. Open PowerShell as Administrator
```powershell
cd d:\Kerja\osrm_service
```

### **Step 2: Install Dependencies**
```powershell
# Install Node.js packages
npm install
```

### **Step 3: Download & Process OSM Data**

**Option A: Automated Setup (Recommended)**
```powershell
# Complete automated setup
.\COMPLETE-SETUP.ps1
```

**Option B: Manual Step-by-Step**
```powershell
# 1. Download Java OSM data (~180MB)
.\scripts\download-pbf.ps1

# 2. Process data for OSRM (10-20 minutes)
.\scripts\process-osrm-v6.ps1
```

### **Step 4: Start Services**

**Option A: Docker (Recommended)**
```powershell
# Interactive Docker manager
.\DOCKER-MANAGER.ps1
# Pilih: 1. Start All Services

# Or quick command
.\docker.ps1 start
```

**Option B: Manual Start**
```powershell
# Start OSRM backend only
docker-compose up -d osrm-backend

# Start API server separately
npm start
```

### **Step 5: Verify Installation**
```powershell
# Test all endpoints
.\TEST-API.ps1

# Check service status
.\docker.ps1 status

# View cache statistics
.\docker.ps1 cache
```

## 🎯 Windows Management Commands

### **Cache Management**
```powershell
# Interactive cache manager
.\CACHE-MANAGER.ps1

# Preload Java Island tiles
.\docker.ps1 preload

# Monitor preload progress (real-time)
# Dalam CACHE-MANAGER.ps1 pilih: 3. Monitor Progress
```

### **Service Management**
```powershell
# Start all services
.\docker.ps1 start

# Stop all services  
.\docker.ps1 stop

# View logs
.\docker.ps1 logs

# Check health
.\docker.ps1 health

# Service status
.\docker.ps1 status
```

### **Quick Commands**
```powershell
# Package.json scripts
npm run docker-manager     # Docker management
npm run cache-manager      # Cache management
npm run cache-stats        # View cache stats
npm run preload            # Start preload
```

---

# 🐧 Setup Guide untuk Linux/Ubuntu

## 📋 Prerequisites

### **1. Update System**
```bash
sudo apt update && sudo apt upgrade -y
```

### **2. Install Docker & Docker Compose**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose -y

# Logout and login again, or use:
newgrp docker

# Test Docker
docker --version
docker-compose --version
```

### **3. Install Node.js & npm**
```bash
# Install Node.js 18.x LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### **4. Install Essential Tools**
```bash
sudo apt install -y curl wget jq git
```

## 🚀 Installation Steps

### **Step 1: Download Project**

**Option A: Via Git Clone**
```bash
# Clone repository
git clone https://github.com/YOUR-USERNAME/osrm_service.git
cd osrm_service

# Make scripts executable
chmod +x *.sh
chmod +x scripts/*.sh
```

**Option B: Download & Extract**
```bash
# Download and extract manually
mkdir -p ~/osrm_service
cd ~/osrm_service
# Upload files via SCP/SFTP
```

### **Step 2: Install Dependencies**
```bash
# Install Node.js packages
npm install
```

### **Step 3: Download & Process OSM Data**

**Option A: Automated Setup (Recommended)**
```bash
# Complete automated setup
./COMPLETE-SETUP.sh
```

**Option B: Manual Step-by-Step**
```bash
# 1. Download Java OSM data (~180MB)
./scripts/download-pbf.sh

# 2. Process data for OSRM (10-20 minutes)  
./scripts/process-osrm-v6.sh
```

### **Step 4: Start Services**

**Option A: Docker (Recommended)**
```bash
# Interactive Docker manager
./DOCKER-MANAGER.sh
# Pilih: 1. Start All Services

# Or quick command
./docker.sh start
```

**Option B: Manual Start**
```bash
# Start OSRM backend only
docker-compose up -d osrm-backend

# Start API server separately
npm start
```

### **Step 5: Verify Installation**
```bash
# Test all endpoints
./TEST-API.sh

# Check service status
./docker.sh status

# View cache statistics
./docker.sh cache
```

## 🎯 Linux Management Commands

### **Cache Management**
```bash
# Interactive cache manager
./CACHE-MANAGER.sh

# Preload Java Island tiles
./docker.sh preload

# Monitor preload progress (real-time)
# Dalam CACHE-MANAGER.sh pilih: 3. Monitor Progress
```

### **Service Management**
```bash
# Start all services
./docker.sh start

# Stop all services
./docker.sh stop

# View logs
./docker.sh logs

# Check health
./docker.sh health

# Service status
./docker.sh status
```

### **System Service (Optional)**
```bash
# Create systemd service for auto-start
sudo tee /etc/systemd/system/osrm-service.service > /dev/null <<EOF
[Unit]
Description=OSRM Tile Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/$USER/osrm_service
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
User=$USER
Group=docker

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl enable osrm-service
sudo systemctl start osrm-service
```

---

# 🌐 Services & Endpoints

## **Available Services**
| Service | Port | URL | Description |
|---------|------|-----|-------------|
| Tile Cache Service | 3000 | http://localhost:3000 | Main API & tile serving |
| OSRM Backend | 5000 | http://localhost:5000 | Routing engine |
| Web Demo | 3000 | http://localhost:3000 | Testing interface |

## **API Endpoints**

### **Main API**
```bash
# Health check
GET /

# Routing
GET /route?start=lat,lon&end=lat,lon

# Tiles (PNG format)
GET /tiles/{z}/{x}/{y}.png
```

### **Cache Management**
```bash
# Cache statistics
GET /cache/stats

# Start tile preload (Java Island)
POST /cache/preload
{
  "zoomLevels": [10, 11, 12, 13],
  "bounds": {
    "minLon": 105.0, "maxLon": 114.0,
    "minLat": -8.8, "maxLat": -5.9
  }
}

# Preload single tile
POST /cache/preload/single
{
  "z": 12, "x": 3245, "y": 1876
}

# Clean cache
POST /cache/clean
{
  "type": "all"
}
```

---

# 📁 Project Structure

```
osrm_service/
├── 🗂️ data/                    # OSM & OSRM data
│   ├── java-latest.osm.pbf     # OSM raw data (~180MB)
│   └── java-latest.osrm*       # OSRM processed files
├── 💾 cache/                   # Persistent tile cache
│   ├── tiles/                  # PNG tile files by zoom
│   │   ├── 10/, 11/, 12/...    # Zoom level folders
│   └── metadata/               # Cache metadata
├── 🔧 src/                     # Source code
│   ├── server.js               # Main API server
│   └── tile-cache.js           # Cache management
├── 📜 scripts/                 # Setup scripts
│   ├── download-pbf.*          # Data download
│   └── process-osrm-v6.*       # OSRM processing
├── 🐳 Docker files
│   ├── Dockerfile              # Container image
│   ├── docker-compose.yml      # Multi-service setup
│   └── .dockerignore           # Build optimization
└── 🎮 Management tools
    ├── DOCKER-MANAGER.*        # Interactive Docker control
    ├── CACHE-MANAGER.*         # Interactive cache control
    ├── docker.*                # Quick Docker commands
    ├── COMPLETE-SETUP.*        # Full automation
    ├── START.*                 # Quick start
    ├── STOP.*                  # Quick stop
    └── TEST-API.*              # API testing
```

---

# 📊 Performance & Optimization

## **Cache Performance**
- **Cache Hit**: ~5ms response time
- **Cache Miss**: ~300ms (download + save + serve)
- **Storage**: ~95MB per zoom level (Java Island)
- **Recommended**: Preload zoom 10-13 for optimal performance

## **Zoom Level Guidelines**
| Zoom | Tiles | Storage | Use Case |
|------|-------|---------|----------|
| 10-11 | ~2,500 | ~95MB | Basic navigation |
| 10-12 | ~13,800 | ~520MB | Standard use |
| 10-13 | ~65,000 | ~2.5GB | Detailed routing |
| 10-14 | ~350K | ~13GB | High precision |
| 10-15 | ~1.5M | ~60GB | Maximum detail |

## **System Requirements**
### **Minimum**
- 🖥️ 4GB RAM
- 💾 10GB disk space
- 🌐 Internet (untuk initial data download)
- 🐳 Docker support

### **Recommended**
- 🖥️ 8GB+ RAM  
- 💾 50GB+ SSD
- 🔄 SSD storage untuk cache performance
- 🌐 Good internet untuk tile preload

---

# 🔧 Configuration

## **Environment Variables**
```bash
# Server configuration
PORT=3000
NODE_ENV=production

# OSRM backend
OSRM_URL=http://osrm-backend:5000

# Cache settings  
CACHE_DIR=./cache
CACHE_MODE=smart
PRELOAD_ENABLED=false
MAX_CACHE_SIZE_MB=2000
```

## **Java Island Bounds**
```javascript
{
  "minLon": 105.0,   // West longitude
  "maxLon": 114.0,   // East longitude  
  "minLat": -8.8,    // South latitude
  "maxLat": -5.9     // North latitude
}
```

---

# 🚀 Production Deployment

## **For VPS/Cloud Server**
1. Follow Linux setup steps
2. Configure firewall:
```bash
sudo ufw allow 3000
sudo ufw allow 5000  
```
3. Use systemd service for auto-start
4. Set up reverse proxy (Nginx) for production
5. Configure SSL certificate for HTTPS

## **Docker Production**
```bash
# Production build
docker-compose -f docker-compose.yml up -d --build

# With custom config
docker-compose -f docker-compose.prod.yml up -d
```

---

# ❓ Troubleshooting

## **Common Issues**

### **Docker Issues**
```bash
# Docker not running
sudo systemctl start docker

# Permission denied
sudo usermod -aG docker $USER
# Then logout/login

# Port already in use  
docker-compose down
netstat -tulpn | grep :3000
```

### **OSRM Processing Fails**
```bash
# Check data file
ls -la data/java-latest.osm.pbf

# Re-download if corrupted
rm data/java-latest.osm.pbf
./scripts/download-pbf.sh

# Manual OSRM processing
docker run -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-extract -p /opt/car.lua /data/java-latest.osrm.pbf
```

### **Cache Issues**
```bash
# Clear cache completely
rm -rf cache/tiles/*

# Reset cache permissions
sudo chown -R $USER:$USER cache/
```

### **Memory Issues**
```bash
# Check memory usage
free -h
docker stats

# Reduce cache size
# Edit docker-compose.yml: MAX_CACHE_SIZE_MB=1000
```

---

# 🎉 Success Indicators

✅ **Services Running**: `docker.ps1 status` shows both containers Up  
✅ **OSRM Healthy**: http://localhost:5000/route/v1/driving/106.8,-6.2;107.6,-6.9 returns route  
✅ **Tiles Working**: http://localhost:3000/tiles/10/511/511.png returns image  
✅ **Cache Active**: http://localhost:3000/cache/stats shows statistics  
✅ **API Responding**: http://localhost:3000 shows web interface  

**🎯 Ready for production use!**

---

**📞 Support**: For issues, check logs dengan `docker.ps1 logs` atau `./docker.sh logs`

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

### Cache Management (Direct OSM)

```bash
# Cache statistics
GET /cache/stats

# Start direct tile preload (OSM → Cache)
POST /cache/preload
{
  "zoomLevels": [10, 11, 12, 13],
  "bounds": {
    "minLon": 105.0,
    "maxLon": 114.0,
    "minLat": -8.8,
    "maxLat": -5.9
  }
}

# Preload single tile directly
POST /cache/preload/single
{
  "z": 12,
  "x": 3245,
  "y": 1876
}

# Clean cache
POST /cache/clean
{
  "type": "all"
}
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

## 🐳 Docker Management

### Interactive Docker Manager

```bash
# PowerShell/Bash interactive menu
.\DOCKER-MANAGER.ps1
# atau
./DOCKER-MANAGER.sh

# atau via npm
npm run docker-manager
```

**Docker Features:**

- 🚀 Start/stop all services with one command
- 📋 View real-time logs (separate for each service)
- 📊 Monitor resource usage and container status
- 🔨 Build/rebuild images when code changes
- 🧹 Clean Docker cache and unused resources
- 🔄 Restart services individually or together

**Manual Docker Commands:**

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f tile-cache

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d
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
