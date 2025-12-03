# 🗺️ OSRM Tile Service - Java Island

**Full local** routing dan tile server untuk wilayah Java Island dengan **offline routing** dan **persistent tile caching** dari OpenStreetMap.

## 📚 Documentation

- **[SETUP.md](SETUP.md)** - Complete setup guide (Windows & Linux)
- **[PRODUCTION.md](PRODUCTION.md)** - Production deployment guide

## 🚀 Quick Start

### Prerequisites

- Docker Desktop (Windows) / Docker Engine (Linux)
- Node.js 18+ LTS
- 8GB+ RAM, 50GB+ disk space

### Windows

```powershell
# 1. Clone project
git clone <repo-url>
cd osrm_server

# 2. Automated setup (downloads OSM data + processes OSRM files)
.\MASTER-SETUP.ps1

# 3. Start services
.\START.ps1

# 4. Access at http://localhost:80
```

### Linux/Ubuntu

```bash
# 1. Clone project
git clone <repo-url>
cd osrm_server
chmod +x *.sh scripts/*.sh

# 2. Automated setup
./MASTER-SETUP.sh

# 3. Start services
./START.sh

# 4. Access at http://localhost:80
```

## 🛠️ Management Scripts

```powershell
# Windows
.\START.ps1              # Start all services
.\STOP.ps1               # Stop all services
.\docker.ps1 status      # Check status
.\docker.ps1 logs        # View logs
.\docker.ps1 health      # Health check
.\CACHE-MANAGER.ps1      # Cache management

# Linux
./START.sh               # Start all services
./STOP.sh                # Stop all services
./docker.sh status       # Check status
./docker.sh logs         # View logs
./docker.sh health       # Health check
./CACHE-MANAGER.sh       # Cache management
```

## 🌐 API Endpoints

### Main Services

- **Web Interface**: http://localhost:80/
- **Health Check**: http://localhost:80/health
- **Cache Stats**: http://localhost:80/cache/stats

### Routing API

```bash
GET /route/v1/driving/{lon1},{lat1};{lon2},{lat2}

# Example
curl "http://localhost/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753"
```

### Tiles API

```bash
GET /tiles/{z}/{x}/{y}.png

# Example
curl "http://localhost/tiles/10/511/511.png"
```

## 📊 Architecture

```
Internet
    ↓
[Nginx] Port 80/443 - Reverse Proxy & Load Balancer
    ↓
[API-1] [API-2] - Node.js API + File Cache
    ↓
[OSRM Backend] - Routing Engine
```

**Services:**

- **Nginx**: Load balancer, rate limiting, proxy caching
- **API Instances**: 2x Node.js servers for redundancy
- **OSRM Backend**: Routing engine with Java Island data
- **File Cache**: Persistent tile storage

## 🚀 Production Deployment

See **[PRODUCTION.md](PRODUCTION.md)** for complete guide:

```bash
# Quick production deploy
cd /opt/osrm-service
./deploy-production.sh

# Or manual
docker-compose up -d --build
```

## ❓ Troubleshooting

### Docker Not Running

```bash
# Windows: Start Docker Desktop
# Linux: sudo systemctl start docker

# Check status
docker-compose ps
```

### OSRM Processing Fails

```bash
# Check data file exists
ls -la data/java-latest.osm.pbf

# Re-download if needed
.\scripts\download-pbf.ps1  # Windows
./scripts/download-pbf.sh   # Linux
```

### Port Already in Use

```bash
# Windows
netstat -ano | findstr :80

# Linux
sudo lsof -i :80

# Stop conflicting service or edit docker-compose.yml
```

### High Memory Usage

```bash
# Check usage
docker stats

# Restart services
docker-compose restart
```

---

## 📖 Additional Resources

- [OSRM Documentation](http://project-osrm.org/)
- [OpenStreetMap Data](https://www.openstreetmap.org/)
- [Geofabrik Downloads](https://download.geofabrik.de/)

---

**🗺️ Powered by OpenStreetMap • OSRM • Docker**

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
