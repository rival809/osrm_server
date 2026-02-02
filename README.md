# 🗺️ OSRM Service - Java Island

**100% Self-Hosted** routing, map tiles, dan geocoding service untuk wilayah Java Island.

## ✨ Features

- 🗺️ **Routing** - Calculate routes between coordinates (OSRM Backend)
- 🗺️ **Map Tiles** - Self-hosted tiles dari MBTiles (Tileserver-GL)
- 📍 **Geocoding** - Koordinat ↔ Nama lokasi (Nominatim + PostgreSQL)
- 🐋 **Docker-based** - 5 containers, easy deployment
- ⚡ **Ready to use** - Routing & tiles ready dalam 1 menit, geocoding dalam 2-4 jam

## 📚 Documentation

**Essential Docs:**

- **[API-SPECIFICATION.md](API-SPECIFICATION.md)** - API endpoints & usage
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture diagram
- **[BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md)** - Integration guide untuk backend team

---

## 🚀 Quick Start

### Server Requirements

- **RAM:** 8GB minimum, 16GB recommended
- **Storage:** 150GB+ (untuk data + Nominatim database)
- **CPU:** 4+ cores
- **OS:** Ubuntu 20.04+, Debian 11+, atau Windows Server

### Setup (20-40 menit)

**Linux/Ubuntu:**

```bash
# 1. Clone project
git clone <repo-url> osrm_service
cd osrm_service
chmod +x *.sh scripts/*.sh

# 2. Setup data (download + process PBF → MBTiles + OSRM files)
./MASTER-SETUP.sh
# ✅ Downloads Java Island PBF (~800MB)
# ✅ Converts to MBTiles for tiles
# ✅ Processes OSRM routing data
# ⏱️ Takes 20-40 minutes

# 3. Start all services
docker compose build --no-cache
docker compose up -d

# 4. Check status
docker compose ps
```

**Windows:**

```powershell
# 1. Clone project
git clone <repo-url> osrm_service
cd osrm_service

# 2. Setup data
.\MASTER-SETUP.ps1

# 3. Start services
docker compose build --no-cache
docker compose up -d

# 4. Check status
docker compose ps
```

### Service Status

After `docker compose up -d`:

| Service               | Status       | Time      | Port |
| --------------------- | ------------ | --------- | ---- |
| **OSRM Backend**      | ✅ Ready     | ~30 sec   | 5000 |
| **Tileserver**        | ✅ Ready     | ~30 sec   | 5001 |
| **osrm-tile-service** | ✅ Ready     | ~30 sec   | 81   |
| **PostgreSQL**        | ✅ Ready     | ~30 sec   | 5432 |
| **Nominatim**         | ⏳ Importing | 2-4 hours | 5002 |

**Note:** Routing & tiles langsung bisa dipakai. Geocoding ready setelah Nominatim selesai import.

### Monitor Nominatim Import

```bash
# Real-time logs
docker compose logs -f nominatim

# Check progress
watch -n 30 "df -h && docker compose ps"
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

---

## 🌐 API Usage

**Base URL:** `http://localhost:81` (atau IP server Anda)

### 1. Health Check

```bash
curl http://localhost:81/health
```

### 2. Routing API

```bash
# Calculate route
curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722"

# Response
{
  "success": true,
  "data": {
    "distance": 12345.67,  // meters
    "duration": 1234.56,   // seconds
    "routes": [...]
  }
}
```

### 3. Geocoding API

**Reverse Geocoding** (koordinat → nama):

```bash
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"

# Response
{
  "success": true,
  "location": {
    "display_name": "Jalan Asia Afrika, Bandung, Jawa Barat",
    "name": "Jalan Asia Afrika"
  },
  "address": {
    "road": "Jalan Asia Afrika",
    "city": "Bandung",
    "state": "Jawa Barat"
  }
}
```

**Forward Geocoding** (nama → koordinat):

```bash
curl "http://localhost:81/geocode/search?q=Bandung"

# Response
{
  "success": true,
  "results": [
    {
      "display_name": "Bandung, Jawa Barat, Indonesia",
      "lat": "-6.9175",
      "lon": "107.6191"
    }
  ]
}
```

### 4. Map Tiles

```bash
# Get tile image
curl "http://localhost:81/tiles/11/1633/1063.png"
```

**Full API documentation:** [API-SPECIFICATION.md](API-SPECIFICATION.md)

---

## 🛠️ Service Management

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs (all)
docker compose logs -f

# View logs (specific)
docker compose logs -f nominatim

# Check status
docker compose ps

# Restart service
docker compose restart osrm-tile-service
```

---

## 🏗️ Architecture

```
Client Request → Port 81
         ↓
  [osrm-tile-service]
         ├─→ /route → [osrm-backend:5000] Routing
         ├─→ /tiles → [tileserver:5001] Map Tiles
         └─→ /geocode → [nominatim:5002] → [postgres:5432] Geocoding
```

**5 Docker Containers:**

1. **osrm-tile-service** (Port 81) - Express.js API proxy
2. **osrm-backend** (Port 5000) - Routing engine
3. **tileserver** (Port 5001) - Map tiles from MBTiles
4. **nominatim** (Port 5002) - Geocoding service
5. **postgres** (Port 5432) - Database untuk Nominatim

**Full architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)

---# Tileserver (internal Docker network)
TILE_SERVER_URL=http://tileserver:8080/styles/basic-preview

# Nominatim (internal Docker network)

NOMINATIM_URL=http://nominatim:8080

# Memory limit (adjust based on server capacity)

MAX_MEMORY_MB=10000

````

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
````

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

## � License

MIT

---

**Powered by OpenStreetMap, OSRM, Tileserver-GL, Nominatim**
