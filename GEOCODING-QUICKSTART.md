# 🚀 Quick Start: Setup Nominatim Geocoding

## TL;DR

```powershell
# Windows - Setup in 3 commands
.\scripts\setup-nominatim.ps1  # Takes 2-4 hours
docker-compose up -d            # Start all services
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"  # Test
```

```bash
# Linux - Setup in 3 commands
./scripts/setup-nominatim.sh  # Takes 2-4 hours
docker-compose up -d            # Start all services
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"  # Test
```

## What You Get

✅ **Reverse Geocoding**: Koordinat → Nama lokasi  
✅ **Forward Geocoding**: Nama → Koordinat  
✅ **100% Offline**: Tidak perlu API key atau internet  
✅ **Full Java Island**: Data lengkap dari OSM

## Requirements

- 8GB RAM (4GB routing + 4GB geocoding)
- 30GB disk space
- Docker Desktop/Engine running
- PBF file: `data/java-latest.osm.pbf` (sudah ada dari MASTER-SETUP)

## API Examples

### 1. Get Location Name from Coordinates

```bash
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"
```

Response:

```json
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

### 2. Search for Locations

```bash
curl "http://localhost:81/geocode/search?q=Bandung"
```

Response:

```json
{
  "success": true,
  "results": [
    {
      "display_name": "Bandung, Jawa Barat, Indonesia",
      "coordinates": { "lat": -6.9175, "lon": 107.6191 }
    }
  ]
}
```

## Services Overview

| Service           | Port | Purpose                        |
| ----------------- | ---- | ------------------------------ |
| osrm-tile-service | 81   | Main API (routing + geocoding) |
| osrm-backend      | 5000 | Routing engine                 |
| tileserver        | 5001 | Map tiles                      |
| nominatim         | 5002 | Geocoding API                  |
| postgres          | 5432 | Geocoding database             |

## Import Time

- **Java Island**: 2-4 hours (~550MB PBF)
- **Monitor**: `docker-compose logs -f nominatim`
- **Check status**: `curl http://localhost:5002/status.php?format=json`

## Database Containerized

✅ **Yes!** Database is fully containerized:

- PostgreSQL + PostGIS container
- Data stored in Docker volume `postgres-data`
- No manual database setup needed
- Backup with `docker exec osrm-postgres pg_dump`

## Troubleshooting

### Import taking too long?

```powershell
# Check progress
docker-compose logs --tail 50 nominatim

# Check if it's working
curl http://localhost:5002/status.php?format=json
```

### Out of memory?

Edit `docker-compose.yml`:

```yaml
postgres:
  environment:
    - POSTGRES_SHARED_BUFFERS=1GB # Reduce from 2GB
```

### Want to restart?

```powershell
# Remove everything and start fresh
docker-compose down -v
.\scripts\setup-nominatim.ps1
```

## Full Documentation

📖 See [NOMINATIM-SETUP.md](NOMINATIM-SETUP.md) for complete guide

## Cost Comparison

| Service                   | Cost/month           |
| ------------------------- | -------------------- |
| **Google Maps Geocoding** | $5,000 (1M requests) |
| **Self-Hosted Nominatim** | $0-50 (VPS only)     |
| **Savings**               | **99%** 💰           |

## Next Steps

1. ✅ Run: `.\scripts\setup-nominatim.ps1`
2. ⏳ Wait 2-4 hours for import
3. 🧪 Test: `curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"`
4. 🚀 Integrate with your app
5. 📊 Monitor: `docker stats`
