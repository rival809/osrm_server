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

# 2. Automated data preparation (downloads OSM data + processes OSRM files)
.\MASTER-SETUP.ps1
# Note: This script only prepares data, does not start services

# 3. Build and start services

# Development mode (8.5GB RAM)
docker-compose build --no-cache
docker-compose up -d

# OR Production mode (12.5GB RAM - recommended for 16GB server)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 4. Check status
docker-compose ps
docker-compose logs -f

# 5. Access at http://localhost:80
```

### Linux/Ubuntu

```bash
# 1. Clone project
git clone <repo-url>
cd osrm_server
chmod +x *.sh scripts/*.sh

# 2. Automated data preparation (downloads OSM + processes OSRM files)
./MASTER-SETUP.sh
# Note: This script only prepares data, does not start services

# 3. Apply docker group (optional, to avoid sudo)
newgrp docker
# Or logout/login to apply group membership

# 4. Build and start services

# Development mode (8.5GB RAM)
docker-compose build --no-cache
docker-compose up -d

# OR Production mode (12.5GB RAM - recommended for 16GB server)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 5. Check service status
docker-compose ps
docker-compose logs -f

# 6. Access at http://localhost:80
```

## 🛠️ Service Management

### Start Services

```bash
# Development mode (8.5GB RAM)
docker-compose up -d

# Production mode (12.5GB RAM - recommended for 16GB server)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# With rebuild (after code changes)
docker-compose up -d --build
```

### Stop Services

```bash
# Stop all services (works for both dev and prod)
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### Monitor Services

```bash
# Check status
docker-compose ps

# View logs (all services)
docker-compose logs -f

# View logs (specific service)
docker-compose logs -f nginx
docker-compose logs -f osrm-api-1
docker-compose logs -f osrm-backend

# Check resource usage
docker stats

# Health check
curl http://localhost/health
```

### Restart Services

```bash
# Restart all (works for both dev and prod)
docker-compose restart

# Restart specific service
docker-compose restart nginx
docker-compose restart osrm-api-1

# Rebuild and restart specific service (after code changes)
docker-compose up -d --no-deps --build osrm-api-1
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

See **[PRODUCTION.md](PRODUCTION.md)** for complete guide.

### Docker Compose Modes

Docker Compose supports **config layering** - you can merge multiple config files to create different deployment modes.

#### 📁 Configuration Files:

- **`docker-compose.yml`** - Base configuration (complete & standalone)

  - Contains all services, volumes, networks
  - Can run independently for development
  - Lower resource limits (2-4GB per service)

- **`docker-compose.prod.yml`** - Production overrides (addon only)
  - Contains only changes/enhancements
  - CANNOT run alone (must be merged with base)
  - Higher resource limits (3-6GB per service)
  - Environment variable overrides

#### 🔄 How Override Works:

When using `-f` flag multiple times, Docker merges configs:

```
Base Config + Override Config = Final Config
```

Properties in override file **replace** matching properties in base file.

---

**Development Mode** (Default - Lower Resources):

```bash
# Uses only docker-compose.yml
docker-compose build --no-cache
docker-compose up -d
```

**Production Mode** (Higher Resources - Optimized for 16GB RAM):

```bash
# Merges docker-compose.yml + docker-compose.prod.yml
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

#### 📊 Resource Allocation Comparison:

| Mode     | Backend    | API-1        | API-2        | Cache/API | Total RAM |
| -------- | ---------- | ------------ | ------------ | --------- | --------- |
| **Dev**  | 4GB, 2 CPU | 2GB, 1 CPU   | 2GB, 1 CPU   | 1000MB    | ~8.5GB    |
| **Prod** | 6GB, 3 CPU | 3GB, 1.5 CPU | 3GB, 1.5 CPU | 1500MB    | ~12.5GB   |

#### ⚙️ What Gets Overridden in Production:

| Service          | Property Overridden | Dev Value | Prod Value |
| ---------------- | ------------------- | --------- | ---------- |
| **osrm-api-1**   | Memory Limit        | 2GB       | 3GB        |
|                  | CPU Limit           | 1.0       | 1.5        |
|                  | MAX_CACHE_SIZE_MB   | 1000      | 1500       |
|                  | NODE_OPTIONS        | 1536      | 2048       |
| **osrm-api-2**   | (Same as API-1)     | (Same)    | (Same)     |
| **osrm-backend** | Memory Limit        | 4GB       | 6GB        |
|                  | CPU Limit           | 2.0       | 3.0        |
|                  | Memory Reservation  | -         | 4GB        |
| **nginx**        | Memory Limit        | -         | 512MB      |
|                  | CPU Limit           | -         | 0.5        |

#### 🎯 Quick Commands:

```bash
# Development (base config only)
docker-compose up -d

# Production (base + override merged)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Stop services (works for both modes)
docker-compose down

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

#### 💡 Understanding the System:

**Why two files?**

- **DRY Principle**: No config duplication
- **Maintainability**: Change base → affects all modes
- **Flexibility**: Easy to add more environments (staging, testing)

**Common Misconceptions:**

- ❌ "They are different configs" → ✅ They merge together
- ❌ "Prod file is complete" → ✅ Prod file only has overrides
- ❌ "Must choose one" → ✅ Dev uses base only, Prod uses both

**Analogy:**

```
Base Config (docker-compose.yml) = Complete outfit 👕👖👟
                                    Can wear alone ✅

Prod Override (.prod.yml)        = Winter jacket 🧥
                                    Can't wear alone ❌
                                    Wear over base outfit ✅
```

---

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

# Check OSRM processed files (should have 26 files)
ls -la data/java-latest.osrm*

# Re-download if needed
.\scripts\download-pbf.ps1  # Windows
./scripts/download-pbf.sh   # Linux

# Reprocess OSRM data
# MASTER-SETUP.sh will ask if you want to reprocess if ≥3 files exist
./MASTER-SETUP.sh
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

# Or switch to development mode (lower resources)
docker-compose down
docker-compose up -d  # Without prod override
```

### Docker Images Missing (ContainerConfig Error)

```bash
# Error: 'ContainerConfig' or 'No such image'
# Solution: Rebuild images from scratch

docker-compose down
docker-compose build --no-cache
docker-compose up -d
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
