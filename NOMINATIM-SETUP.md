# 🗺️ Nominatim Geocoding Setup

## Overview

Nominatim service untuk **offline reverse geocoding** (koordinat → nama lokasi) dan **forward geocoding** (nama → koordinat) menggunakan data Java Island.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client Request                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│            osrm-tile-service (Port 81)                   │
│  - /geocode/reverse?lat=-6.9175&lon=107.6191            │
│  - /geocode/search?q=Bandung                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│            Nominatim API (Port 5002)                     │
│  - mediagis/nominatim:4.4 container                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│         PostgreSQL + PostGIS (Port 5432)                │
│  - postgis/postgis:16-3.4 container                     │
│  - Database: ~10-20GB for Java Island                   │
└─────────────────────────────────────────────────────────┘
```

## Components

### 1. PostgreSQL + PostGIS

- **Image**: `postgis/postgis:16-3.4`
- **Port**: 5432
- **Database**: `nominatim`
- **Credentials**: `nominatim` / `nominatim123`
- **Storage**: Docker volume `postgres-data`
- **Memory**: ~2-4GB RAM

### 2. Nominatim

- **Image**: `mediagis/nominatim:4.4`
- **Port**: 5002
- **Data Source**: `data/java-latest.osm.pbf`
- **Import Time**: 2-4 hours for Java Island
- **Storage**: Docker volume `nominatim-data`
- **Memory**: ~2-4GB RAM during import

## Setup Instructions

### Prerequisites

- Docker Desktop (Windows) / Docker Engine (Linux)
- 8GB+ RAM available
- 20GB+ free disk space
- PBF file: `data/java-latest.osm.pbf` (already exists)

### Windows

```powershell
# 1. Run setup script (import will take 2-4 hours)
.\scripts\setup-nominatim.ps1

# 2. Monitor import progress
docker-compose logs -f nominatim

# 3. Check import status
curl "http://localhost:5002/status.php?format=json"

# 4. When complete, start full stack
docker-compose up -d

# 5. Test geocoding
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"
```

### Linux

```bash
# 1. Make script executable
chmod +x scripts/setup-nominatim.sh

# 2. Run setup script
./scripts/setup-nominatim.sh

# 3. Monitor import progress
docker-compose logs -f nominatim

# 4. Check import status
curl "http://localhost:5002/status.php?format=json"

# 5. When complete, start full stack
docker-compose up -d

# 6. Test geocoding
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"
```

## API Endpoints

### 1. Reverse Geocoding (Koordinat → Nama)

**Endpoint**: `GET /geocode/reverse`

**Parameters**:

- `lat`: Latitude (-90 to 90)
- `lon`: Longitude (-180 to 180)
- `zoom`: Detail level (1-18, default: 18)

**Example Request**:

```bash
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"
```

**Example Response**:

```json
{
  "success": true,
  "region": "Java Island",
  "mode": "offline",
  "responseTime": "45ms",
  "coordinates": {
    "lat": -6.9175,
    "lon": 107.6191
  },
  "location": {
    "display_name": "Jalan Asia Afrika, Bandung, Jawa Barat, Indonesia",
    "name": "Jalan Asia Afrika",
    "place_id": 123456,
    "osm_type": "way",
    "osm_id": 789012,
    "type": "road",
    "class": "highway"
  },
  "address": {
    "road": "Jalan Asia Afrika",
    "city": "Bandung",
    "state": "Jawa Barat",
    "country": "Indonesia",
    "postcode": "40111"
  },
  "boundingbox": ["-6.9180", "-6.9170", "107.6185", "107.6195"]
}
```

### 2. Forward Geocoding (Nama → Koordinat)

**Endpoint**: `GET /geocode/search`

**Parameters**:

- `q`: Search query (min 2 chars)
- `limit`: Max results (default: 5)
- `countrycodes`: Country filter (default: 'id')

**Example Request**:

```bash
curl "http://localhost:81/geocode/search?q=Bandung&limit=5"
```

**Example Response**:

```json
{
  "success": true,
  "region": "Java Island",
  "mode": "offline",
  "responseTime": "120ms",
  "query": "Bandung",
  "count": 5,
  "results": [
    {
      "display_name": "Bandung, Jawa Barat, Indonesia",
      "name": "Bandung",
      "place_id": 123456,
      "coordinates": {
        "lat": -6.9175,
        "lon": 107.6191
      },
      "address": {
        "city": "Bandung",
        "state": "Jawa Barat",
        "country": "Indonesia"
      }
    }
  ]
}
```

## Direct Nominatim API

You can also use Nominatim directly (port 5002):

```bash
# Reverse geocoding
curl "http://localhost:5002/reverse?lat=-6.9175&lon=107.6191&format=json"

# Forward geocoding
curl "http://localhost:5002/search?q=Bandung&format=json"

# Status check
curl "http://localhost:5002/status.php?format=json"
```

## Import Process

### What Happens During Import?

1. **Data Loading** (30-60 minutes)
   - Reads PBF file into PostgreSQL
   - Creates tables and indexes

2. **Indexing** (60-120 minutes)
   - Builds spatial indexes
   - Creates geocoding indexes
   - Optimizes for queries

3. **Finalization** (10-30 minutes)
   - Cleanup and optimization
   - Status becomes ready

### Monitoring Import

```powershell
# Watch logs
docker-compose logs -f nominatim

# Check status (status: 0 = ready)
curl "http://localhost:5002/status.php?format=json"

# Check PostgreSQL size
docker exec osrm-postgres psql -U nominatim -c "SELECT pg_size_pretty(pg_database_size('nominatim'));"
```

## Resource Usage

### During Import

- **CPU**: High usage (will use all available cores)
- **RAM**: 4-8GB
- **Disk I/O**: Very high
- **Time**: 2-4 hours

### After Import (Running)

- **CPU**: Low (only during queries)
- **RAM**: 2-4GB
- **Disk**: 10-20GB for database
- **Query Time**: 10-100ms

## Data Scope

### What's Included in Java Island Data

✅ **Included**:

- Roads (major and minor)
- Cities and villages
- Districts and subdistricts
- Points of Interest (POI)
- Buildings (major)
- Administrative boundaries
- Natural features

❌ **Not Included**:

- Data outside Java Island
- Real-time updates
- User-generated content

## Maintenance

### Update Data

To update with new PBF data:

```powershell
# 1. Download new PBF
.\scripts\download-pbf-improved.ps1

# 2. Stop and remove old data
docker-compose down -v

# 3. Re-import
.\scripts\setup-nominatim.ps1
```

### Backup Database

```powershell
# Backup
docker exec osrm-postgres pg_dump -U nominatim nominatim > nominatim-backup.sql

# Restore
docker exec -i osrm-postgres psql -U nominatim nominatim < nominatim-backup.sql
```

### Clean Up

```powershell
# Remove containers only (keep data)
docker-compose stop nominatim postgres
docker-compose rm -f nominatim postgres

# Remove everything including database
docker-compose down -v
```

## Troubleshooting

### Import Stuck or Failed

```powershell
# Check logs
docker-compose logs --tail 100 nominatim

# Restart import (removes old data)
docker-compose down -v
.\scripts\setup-nominatim.ps1
```

### Out of Memory

Edit [docker-compose.yml](docker-compose.yml):

```yaml
postgres:
  environment:
    - POSTGRES_SHARED_BUFFERS=1GB # Reduce from 2GB
    - POSTGRES_WORK_MEM=25MB # Reduce from 50MB
```

### Slow Queries

```sql
-- Check indexes
docker exec osrm-postgres psql -U nominatim -c "\di"

-- Analyze tables
docker exec osrm-postgres psql -U nominatim -c "ANALYZE;"
```

### Port Conflicts

If port 5432 or 5002 is in use:

Edit [docker-compose.yml](docker-compose.yml):

```yaml
postgres:
  ports:
    - "15432:5432" # Change from 5432

nominatim:
  ports:
    - "15002:8080" # Change from 5002
```

## Performance Tuning

### For Faster Import

Edit [docker-compose.yml](docker-compose.yml):

```yaml
nominatim:
  environment:
    - THREADS=8 # Increase from 4 (match your CPU cores)
```

### For Production

```yaml
postgres:
  environment:
    - POSTGRES_SHARED_BUFFERS=4GB # Increase if you have RAM
    - POSTGRES_EFFECTIVE_CACHE_SIZE=8GB
    - POSTGRES_MAX_CONNECTIONS=100
```

## Integration Examples

### JavaScript/Node.js

```javascript
const axios = require("axios");

async function reverseGeocode(lat, lon) {
  const response = await axios.get("http://localhost:81/geocode/reverse", {
    params: { lat, lon },
  });
  return response.data;
}

async function searchLocation(query) {
  const response = await axios.get("http://localhost:81/geocode/search", {
    params: { q: query, limit: 5 },
  });
  return response.data;
}

// Usage
reverseGeocode(-6.9175, 107.6191).then((result) =>
  console.log(result.location.display_name),
);

searchLocation("Bandung").then((result) => console.log(result.results));
```

### Python

```python
import requests

def reverse_geocode(lat, lon):
    response = requests.get('http://localhost:81/geocode/reverse',
        params={'lat': lat, 'lon': lon})
    return response.json()

def search_location(query):
    response = requests.get('http://localhost:81/geocode/search',
        params={'q': query, 'limit': 5})
    return response.json()

# Usage
result = reverse_geocode(-6.9175, 107.6191)
print(result['location']['display_name'])

results = search_location('Bandung')
print(results['results'])
```

### curl

```bash
# Reverse geocoding
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191" | jq .

# Search
curl "http://localhost:81/geocode/search?q=Bandung&limit=5" | jq .
```

## Cost Analysis

### vs Google Maps Geocoding API

For 1 million requests/month:

| Service                   | Cost                           |
| ------------------------- | ------------------------------ |
| **Google Maps**           | ~$5,000/month                  |
| **Nominatim Self-Hosted** | ~$50/month (server only)       |
| **Savings**               | **$4,950/month** (99% cheaper) |

### Infrastructure Costs

- **VPS**: $20-50/month (4GB RAM, 50GB disk)
- **Or**: Free if running on existing infrastructure
- **Data updates**: Free (download from Geofabrik)

## Next Steps

1. ✅ Run setup script: `.\scripts\setup-nominatim.ps1`
2. ⏳ Wait for import (2-4 hours)
3. 🧪 Test endpoints
4. 🚀 Integrate with your application
5. 📊 Monitor performance
6. 🔄 Schedule monthly data updates

## References

- [Nominatim Documentation](https://nominatim.org/release-docs/latest/)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Docker Nominatim Image](https://github.com/mediagis/nominatim-docker)
- [Geofabrik Downloads](https://download.geofabrik.de/)
