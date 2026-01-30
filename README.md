# 🗺️ OSRM Tile Service - Java Island

**100% Self-Hosted** routing dan tile server untuk wilayah Java Island dengan **offline routing** dan **local tile generation** dari PBF file lokal.

## ✨ Key Features

- 🗺️ **100% Self-Hosted** - Tidak perlu koneksi ke tile.openstreetmap.org
- 🚀 **Lightweight Proxy** - Simple architecture tanpa file caching
- 🐋 **Docker-based** - Easy deployment dengan 5 containers
- 📍 **Java Island Coverage** - Optimized untuk routing di Pulau Jawa
- 🔄 **Tileserver-GL** - Generate tiles on-the-fly dari MBTiles lokal
- 🌐 **Offline Geocoding** - Reverse geocoding dengan Nominatim + PostgreSQL

## 📚 Documentation

### Getting Started
- **[SETUP.md](SETUP.md)** - Development setup guide (Windows & Linux)
- **[TILESERVER-SETUP.md](TILESERVER-SETUP.md)** - Setup tileserver dari PBF file
- **[NOMINATIM-SETUP.md](NOMINATIM-SETUP.md)** - Setup geocoding (koordinat ↔ nama lokasi)
- **[GEOCODING-QUICKSTART.md](GEOCODING-QUICKSTART.md)** - Quick start geocoding

### Production Deployment
- **[SERVER-DEPLOYMENT.md](SERVER-DEPLOYMENT.md)** - 🚀 Complete server deployment guide
- **[DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md)** - ✅ Step-by-step checklist
- **[DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md)** - Legacy deployment guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture & diagram

## 🚀 Quick Start

### Prerequisites

- Docker Desktop (Windows) / Docker Engine (Linux)
- 8GB+ RAM (4GB for routing, 4GB for geocoding), 30GB+ disk space
- **For tileserver setup:** PBF file atau akses internet untuk download
- **For geocoding:** Additional 2-4 hours for Nominatim import

### Windows

```powershell
# 1. Clone project
git clone <repo-url>
cd osrm_service

# 2. Setup data (PBF + MBTiles + OSRM processing)
# Option A: Automated (downloads + processes everything)
.\MASTER-SETUP.ps1

# Option B: Manual tileserver setup (if you have PBF file)
.\scripts\setup-tileserver.ps1

# 3. Build and start services
docker compose build --no-cache
docker compose up -d

# 4. Check status
docker compose ps

# 5. Access at http://localhost:81
```

### Linux/Ubuntu

```bash
# 1. Clone project
git clone <repo-url>
cd osrm_service
chmod +x *.sh scripts/*.sh

# 2. Setup data (PBF + MBTiles + OSRM processing)
# Option A: Automated (downloads + processes everything)
./MASTER-SETUP.sh

# Option B: Manual tileserver setup (if you have PBF file)
./scripts/setup-tileserver.sh

# 3. Build and start services
docker compose build --no-cache
docker compose up -d

# 4. Check service status
docker compose ps

# 5. Access at http://localhost:81
```

## 🛠️ Service Management

### Start Services

```bash
# Start all containers
docker compose up -d

# With rebuild (after code changes)
docker compose up --build -d

# Start specific service
docker compose up -d osrm-tile-service
```

### Stop Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes
docker compose down -v
```

### Monitor Services

```bash
# Check status
docker compose ps

# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f osrm-tile-service
docker compose logs -f osrm-backend
docker compose logs -f tileserver
docker compose logs -f nominatim
docker compose logs -f postgres

# Check resource usage
docker stats

# Health check
curl http://localhost:81/health
```

### Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart osrm-tile-service

# Rebuild and restart specific service (after code changes)
docker compose up --build -d osrm-tile-service
```

## 🌐 API Endpoints

### Main Services

- **Web Interface**: http://localhost:81/
- **Health Check**: http://localhost:81/health

### Routing API

```bash
# Query parameters
GET /route?start=lon,lat&end=lon,lat

# Example: Bandung to Cimahi
curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722"

# Response
{
  "success": true,
  "data": {
    "routes": [...],
    "distance": 12345.67,
    "duration": 1234.56
  }
}
```

### Geocoding API

```bash
# Reverse Geocoding (koordinat → nama lokasi)
GET /geocode/reverse?lat=-6.9175&lon=107.6191

# Example: Get location name from coordinates
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"

# Response
{
  "success": true,
  "location": {
    "display_name": "Jalan Asia Afrika, Bandung, Jawa Barat, Indonesia",
    "name": "Jalan Asia Afrika"
  },
  "address": {
    "road": "Jalan Asia Afrika",
    "city": "Bandung",
    "state": "Jawa Barat"
  }
}

# Forward Geocoding (nama → koordinat)
GET /geocode/search?q=Bandung&limit=5

# Example: Search for locations
curl "http://localhost:81/geocode/search?q=Bandung&limit=5"

# Response
{
  "success": true,
  "query": "Bandung",
  "count": 5,
  "results": [
    {
      "display_name": "Bandung, Jawa Barat, Indonesia",
      "coordinates": { "lat": -6.9175, "lon": 107.6191 }
    }
  ]
}
```

**Architecture:**

```
Client Request
    ↓
[osrm-tile-service] Port 81 - Express.js Proxy
    ├─→ /route             → [osrm-backend] Port 5000 (Routing)
    ├─→ /tiles             → [tileserver] Port 5001 (Tiles from MBTiles)
    └─→ /geocode/*         → [nominatim] Port 5002 → [postgres] (Geocoding)
```

**Containers:**

1. **osrm-tile-service** (Port 81)
   - Lightweight Express.js proxy
   - Routes `/route` to OSRM backend
   - Routes `/tiles` to tileserver
   - Routes `/geocode/*` to Nominatim
   - No file caching (pure proxy)

2. **osrm-backend** (Port 5000)
   - Routing engine

3. **tileserver** (Port 5001)
   - Map tiles generation

4. **nominatim** (Port 5002)
   - Geocoding service

5. **postgres** (Port 5432)
   - Database for geocoding

### Environment Configuration

Edit `.env` file untuk production:

```bash
# Production settings
NODE_ENV=production
PORT=81

# OSRM Backend (internal Docker network)
OSRM_URL=http://osrm-backend:5000

# Tileserver (internal Docker network)
TILE_SERVER_URL=http://tileserver:8080/styles/basic-preview

# Nominatim (internal Docker network)
NOMINATIM_URL=http://nominatim:8080

# Memory limit (adjust based on server capacity)
MAX_MEMORY_MB=10000
```

### Deployment Steps

```bash
# 1. Clone repository
git clone <repo-url>
cd osrm_service

# 2. Setup data files
./MASTER-SETUP.sh  # Linux
# or
.\MASTER-SETUP.ps1  # Windows

# 3. Build and deploy
docker compose build --no-cache
docker compose up -d

# 4. Verify deployment
docker compose ps
curl http://localhost:81/health
```

### Backend Sambara Integration

**Architecture:**

```
Mobile/Web Users
    ↓
Backend Sambara (Gateway) :8080
    ↓ Rate limiting PER USER
    ↓ Internal network
OSRM Service :81 (No rate limit - trusted internal)
    ↓
OSRM Backend + Tileserver
```

**Important Notes:**

- ✅ Rate limiting **DISABLED** di OSRM service (internal microservice)
- ✅ Backend Sambara **MUST handle** rate limiting per user
- ✅ OSRM service tidak exposed ke public
- ✅ Trust proxy header `X-Forwarded-For` sudah enabled

### Security Recommendations

1. **Firewall Rules:**

   ```bash
   # Only allow access from Backend Sambara IP
   sudo ufw allow from <backend-sambara-ip> to any port 81
   sudo ufw deny 81
   ```

2. **Rate Limiting at Gateway:**
   - Implement per-user rate limiting di Backend Sambara
   - Recommended: 100 requests/minute per user
   - Forward original client IP via `X-Forwarded-ForStop services (works for both modes)
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

Prod Override (.prod.yml) = Winter jacket 🧥
Can't wear alone ❌
Wear over base outfit ✅

````

---

## ❓ Troubleshooting

### Docker Not Running

```bash
# Windows: Start Docker Desktop
# Linux: sudo systemctl start docker

# Check status
docker-compose ps
````

### OSRM Processing Fails

````bash
# Check data file exists
ls -la data/java-latest.osm.pbf

# Check OSRM processed files (should have 26 files)
ls -la data/java-latest.osrm*

# Re-download if needed
.\scripts\download-pbf.ps1  # Windows
./scripts/download-pbf.sh   # Linux
1. Docker Not Running

```bash
# Windows: Start Docker Desktop
# Linux: sudo systemctl start docker

# Check status
docker compose ps
````

### 2. OSRM Processing Fails

```bash
# Check data file exists
ls -la data/java-latest.osm.pbf

# Check OSRM processed files (should have 26+ files)
ls -la data/java-latest.osrm*

# Re-download if needed
.\scripts\download-pbf.ps1  # Windows
./scripts/download-pbf.sh   # Linux

# Reprocess OSRM data
./MASTER-SETUP.sh
```

### 3. Tileserver Not Generating Tiles

```bash
# Check MBTiles file exists
ls -la data/java.mbtiles

# Regenerate MBTiles from PBF
.\scripts\setup-tileserver.ps1  # Windows
./scripts/setup-tileserver.sh   # Linux

# Check tileserver logs
docker compose logs tileserver
```

### 4. Port Already in Use

```bash
# Windows
netstat -ano | findstr :81

# Linux
sudo lsof -i :81

# Change port in .env file
PORT=8081  # or any available port
```

### 5. Container Unhealthy

```bash
# Check container status
docker compose ps

# View logs for errors
docker compose logs osrm-tile-service
docker compose logs osrm-backend
docker compose logs tileserver

# Restart unhealthy container
docker compose restart osrm-tile-service
```

### 6. Tiles Not Loading (404 errors)

```bash
# Test tileserver directly
curl http://localhost:8000/

# Test tile proxy
curl http://localhost:81/tiles/13/6544/4253.png -o test.png

# Check if MBTiles file is properly mounted
docker exec osrm-tileserver ls -la /data/java.mbtiles
```

### 7. Clean Slate (Start Over)

```bash
# Stop all containers
docker compose down

# Prune Docker system
docker system prune -a --volumes -f

# Rebuild from scratch
docker compose build --no-cache
docker compose up -d
```

---

## 📖 Additional Resources

- [OSRM Documentation](http://project-osrm.org/)
- [Tileserver-GL Documentation](https://github.com/maptiler/tileserver-gl)
- [OpenStreetMap Data](https://www.openstreetmap.org/)
- [Geofabrik Downloads](https://download.geofabrik.de/)

---

**🗺️ Powered by OpenStreetMap • OSRM • Tileserver-GL • Docker**

_Self-hosted routing and tile service for Java Island_ 🚀
