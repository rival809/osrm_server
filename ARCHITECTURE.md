# Architecture Overview - OSRM Service dengan Nominatim Geocoding

## Complete Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT / USER                            │
│                    (Browser / Mobile App)                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP Requests
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              OSRM-TILE-SERVICE (Port 81)                         │
│                   Express.js Proxy Layer                         │
│                                                                   │
│  Endpoints:                                                       │
│  • GET /health              - Health check all services          │
│  • GET /route               - Routing (proxy to OSRM)            │
│  • GET /tiles/:z/:x/:y.png  - Map tiles (proxy to Tileserver)   │
│  • GET /geocode/reverse     - Reverse geocoding (koordinat→nama) │
│  • GET /geocode/search      - Forward geocoding (nama→koordinat) │
│                                                                   │
└────┬──────────────┬─────────────────┬──────────────┬────────────┘
     │              │                 │              │
     │              │                 │              │
     ▼              ▼                 ▼              ▼
┌─────────┐  ┌──────────┐   ┌──────────────┐  ┌──────────┐
│  OSRM   │  │TILESERVER│   │  NOMINATIM   │  │ Direct   │
│ Backend │  │   -GL    │   │   API        │  │ Response │
│Port 5000│  │Port 5001 │   │  Port 5002   │  │          │
└────┬────┘  └────┬─────┘   └──────┬───────┘  └──────────┘
     │            │                 │
     │            │                 │
     ▼            ▼                 ▼
┌─────────┐  ┌──────────┐   ┌──────────────┐
│ OSRM    │  │  MBTiles │   │  PostgreSQL  │
│  Data   │  │   File   │   │  + PostGIS   │
│ Files   │  │          │   │  Port 5432   │
│ (.osrm) │  │(java.    │   │              │
│         │  │mbtiles)  │   │  Database:   │
│         │  │          │   │  nominatim   │
└─────────┘  └──────────┘   └──────┬───────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │   Docker    │
                             │   Volume    │
                             │postgres-data│
                             └─────────────┘
```

## Container Details

### 1. **osrm-tile-service** (Main API Gateway)

```yaml
Container: osrm-tile-service
Port: 81 (external) → 81 (internal)
Image: Custom Node.js (built from Dockerfile)
Memory: ~500MB
Role: Lightweight proxy + API gateway
```

**Responsibilities:**

- Route `/route` requests → OSRM Backend
- Route `/tiles` requests → Tileserver
- Route `/geocode/*` requests → Nominatim
- Health checks for all services
- Request validation & logging
- Error handling & response formatting

---

### 2. **osrm-backend** (Routing Engine)

```yaml
Container: osrm-backend
Port: 5000 (external) → 5000 (internal)
Image: ghcr.io/project-osrm/osrm-backend:v6.0.0
Memory: ~2GB
Role: Calculate routes & navigation
```

**Responsibilities:**

- Process routing requests
- Calculate shortest/fastest paths
- Return turn-by-turn directions
- Handle alternatives routes

**Data Source:**

- Pre-processed OSRM files (`java-latest.osrm.*`)
- Located in `./data/` directory

---

### 3. **tileserver** (Map Tile Generator)

```yaml
Container: tileserver
Port: 5001 (external) → 8080 (internal)
Image: maptiler/tileserver-gl:latest
Memory: ~1GB
Role: Generate map tiles on-the-fly
```

**Responsibilities:**

- Serve map tiles in PNG format
- Read from MBTiles SQLite database
- Generate tiles at various zoom levels (0-18)
- Cache tiles in memory

**Data Source:**

- MBTiles file (`java.mbtiles`)
- Located in `./data/` directory

---

### 4. **nominatim** (Geocoding Service)

```yaml
Container: osrm-nominatim
Port: 5002 (external) → 8080 (internal)
Image: mediagis/nominatim:4.4
Memory: 2-4GB during import, 1-2GB running
Role: Reverse & forward geocoding
```

**Responsibilities:**

- Reverse geocoding (lat/lon → address)
- Forward geocoding (address → lat/lon)
- Search for places by name
- Return detailed address information

**Data Source:**

- PostgreSQL database (imported from PBF)
- Takes 2-4 hours to import Java Island data

**API Endpoints:**

- `/reverse?lat=X&lon=Y` - Get address from coordinates
- `/search?q=NAME` - Search for locations
- `/status.php` - Check import status

---

### 5. **postgres** (Database for Geocoding)

```yaml
Container: osrm-postgres
Port: 5432 (external) → 5432 (internal)
Image: postgis/postgis:16-3.4
Memory: 2-4GB
Storage: 10-20GB for Java Island
Role: Store geocoding data
```

**Responsibilities:**

- Store OSM data (roads, places, addresses)
- Spatial indexing with PostGIS
- Fast coordinate-based lookups
- Full-text search for place names

**Database:**

- Name: `nominatim`
- User: `nominatim`
- Password: `nominatim123`
- Extensions: PostGIS, hstore

---

## Data Flow Examples

### Example 1: Reverse Geocoding Request

```
1. Client Request:
   GET http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191

2. osrm-tile-service receives request
   ├─ Validates parameters (lat/lon format)
   ├─ Logs request
   └─ Proxies to: http://nominatim:8080/reverse

3. nominatim processes request
   ├─ Queries PostgreSQL database
   ├─ Finds nearest address/place
   └─ Returns formatted result

4. osrm-tile-service formats response
   └─ Returns JSON to client

Response Time: 10-100ms
```

### Example 2: Forward Geocoding Request

```
1. Client Request:
   GET http://localhost:81/geocode/search?q=Bandung

2. osrm-tile-service receives request
   ├─ Validates query parameter
   ├─ Logs request
   └─ Proxies to: http://nominatim:8080/search

3. nominatim processes request
   ├─ Full-text search in PostgreSQL
   ├─ Ranks results by relevance
   └─ Returns top matches

4. osrm-tile-service formats response
   └─ Returns JSON array to client

Response Time: 50-200ms
```

### Example 3: Routing Request

```
1. Client Request:
   GET http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722

2. osrm-tile-service receives request
   ├─ Validates coordinates
   ├─ Logs request
   └─ Proxies to: http://osrm-backend:5000/route/v1/driving/...

3. osrm-backend calculates route
   ├─ Reads pre-processed graph data
   ├─ Runs MLD algorithm
   └─ Returns route geometry & instructions

4. osrm-tile-service formats response
   └─ Returns JSON to client

Response Time: 50-500ms
```

### Example 4: Map Tile Request

```
1. Client Request:
   GET http://localhost:81/tiles/12/3272/1063.png

2. osrm-tile-service receives request
   ├─ Validates zoom/x/y parameters
   ├─ Logs request
   └─ Proxies to: http://tileserver:8080/styles/basic-preview/12/3272/1063.png

3. tileserver generates tile
   ├─ Queries java.mbtiles SQLite database
   ├─ Renders tile as PNG
   └─ Returns image binary

4. osrm-tile-service forwards image
   ├─ Sets cache headers (24h)
   └─ Returns PNG to client

Response Time: 20-200ms
```

---

## Network Architecture

### Docker Network: `osrm-network`

All containers are connected via a bridge network:

```
osrm-network (bridge)
├─ osrm-tile-service (gateway: port 81)
├─ osrm-backend (internal: port 5000)
├─ tileserver (internal: port 8080)
├─ nominatim (internal: port 8080)
└─ postgres (internal: port 5432)
```

**Internal DNS:**

- Containers can reach each other by name
- Example: `http://nominatim:8080` from osrm-tile-service
- No need for localhost or IP addresses

**External Access:**

- Only port 81 exposed to host
- All services accessed via osrm-tile-service proxy
- Direct access available for debugging:
  - osrm-backend: localhost:5000
  - tileserver: localhost:5001
  - nominatim: localhost:5002
  - postgres: localhost:5432

---

## Storage Volumes

### Docker Volumes

```
postgres-data (Docker volume)
└─ PostgreSQL database files
   └─ ~10-20GB for Java Island

nominatim-data (Docker volume)
└─ Nominatim cache & indexes
   └─ ~5-10GB

./data (Bind mount - Host directory)
├─ java-latest.osm.pbf     (~550MB)
├─ java-latest.osrm.*      (~1.5GB total - OSRM files)
└─ java.mbtiles            (~2GB - Map tiles database)
```

---

## Resource Requirements

### Minimum (Development)

- **RAM**: 8GB total
  - osrm-tile-service: 500MB
  - osrm-backend: 2GB
  - tileserver: 1GB
  - nominatim: 2GB
  - postgres: 2GB
- **Disk**: 30GB
- **CPU**: 2 cores

### Recommended (Production)

- **RAM**: 16GB total
  - osrm-tile-service: 1GB
  - osrm-backend: 4GB
  - tileserver: 2GB
  - nominatim: 4GB
  - postgres: 4GB
- **Disk**: 50GB SSD
- **CPU**: 4+ cores

---

## Security Notes

### ✅ Secured

- All services behind osrm-tile-service proxy
- No direct external access to databases
- Request validation on all endpoints
- Rate limiting (can be enabled)
- Helmet security headers

### ⚠️ Default Credentials

```
PostgreSQL:
  User: nominatim
  Password: nominatim123

⚠️ Change in production!
```

Edit `docker-compose.yml`:

```yaml
postgres:
  environment:
    - POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD

nominatim:
  environment:
    - NOMINATIM_DATABASE_DSN=pgsql:host=postgres;...;password=YOUR_SECURE_PASSWORD
```

---

## Monitoring & Health Checks

### Health Check Endpoint

```bash
curl http://localhost:81/health
```

Response:

```json
{
  "status": "ok",
  "service": "OSRM Tile Service (Self-Hosted Proxy + Geocoding)",
  "region": "Java Island",
  "tileserverStatus": "ok",
  "nominatimStatus": "ok",
  "memory": {
    "current": "450 MB",
    "percent": 45,
    "status": "ok"
  }
}
```

### Container Health Checks

```yaml
# Built-in Docker health checks
osrm-tile-service: wget http://localhost:81/health
nominatim: wget http://localhost:8080/status.php
postgres: pg_isready -U nominatim
```

Check:

```bash
docker-compose ps
```

---

## Maintenance Tasks

### Daily

- Monitor logs: `docker-compose logs -f`
- Check disk space: `docker system df`
- Monitor memory: `docker stats`

### Weekly

- Review health checks
- Check error rates in logs
- Verify geocoding accuracy

### Monthly

- Update PBF data (if needed)
- Analyze query performance
- Database maintenance (VACUUM, ANALYZE)

### Quarterly

- Update Docker images
- Review and update documentation
- Performance tuning
