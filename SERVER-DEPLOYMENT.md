# 🚀 Server Deployment Guide - OSRM dengan Nominatim Geocoding

## Requirements Server

### Minimum Specs
- **RAM**: 8GB+ (16GB recommended)
- **Storage**: 40GB+ free space
  - Data PBF: ~850MB
  - OSRM files: ~1.5GB
  - MBTiles: ~2GB
  - **Nominatim DB: ~15-20GB** (ini yang paling besar)
  - PostgreSQL: ~5GB
- **CPU**: 4+ cores
- **OS**: Linux (Ubuntu 20.04+/Debian 11+) atau Windows Server

### Network
- Port 81: Main API (routing + geocoding + tiles)
- Port 5000: OSRM Backend (optional, untuk direct access)
- Port 5001: Tileserver (optional)
- Port 5002: Nominatim (optional)
- Port 5432: PostgreSQL (optional)

## Setup di Server

### 1. Copy Project ke Server

```bash
# Via git
git clone <your-repo> osrm_service
cd osrm_service

# Atau via scp/rsync
rsync -avz --progress osrm_service/ user@server:/path/to/osrm_service/
```

### 2. Install Docker di Server (jika belum)

**Ubuntu/Debian:**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get update
sudo apt-get install docker-compose-plugin

# Verify
docker --version
docker compose version
```

**Windows Server:**
- Download Docker Desktop for Windows Server
- Install seperti biasa

### 3. Pastikan Data Files Ada

```bash
cd osrm_service
ls -lh data/

# Harus ada:
# - java-latest.osm.pbf (~850MB)
# - java-latest.osrm.* (26 files, ~1.5GB total)
# - java.mbtiles (~2GB)
```

Jika belum ada, jalankan:
```bash
# Linux
./MASTER-SETUP.sh

# Windows
.\MASTER-SETUP.ps1
```

### 4. Start Services

```bash
# Build images
docker compose build --no-cache

# Start semua services
docker compose up -d

# Check status
docker compose ps

# Monitor logs
docker compose logs -f
```

### 5. Monitor Nominatim Import (2-4 jam)

Nominatim akan otomatis import data PBF pada first start:

```bash
# Monitor import progress
docker compose logs -f nominatim

# Check status (setelah import selesai, status=0)
curl "http://localhost:5002/status.php?format=json"

# Check PostgreSQL size
docker exec osrm-nominatim sudo -u postgres psql nominatim -c "SELECT pg_size_pretty(pg_database_size('nominatim'));"
```

### 6. Test Services

```bash
# Health check
curl http://localhost:81/health

# Test routing
curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722"

# Test reverse geocoding
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"

# Test forward geocoding
curl "http://localhost:81/geocode/search?q=Bandung"
```

## Production Configuration

### Update Environment Variables

Edit `docker-compose.yml`:

```yaml
osrm-tile-service:
  environment:
    - NODE_ENV=production
    - PORT=81
    - MAX_MEMORY_MB=4000  # Sesuaikan RAM server
    - LOG_LEVEL=info
```

### Enable Rate Limiting (Optional)

Edit `src/server.js`, uncomment rate limiting:

```javascript
// Apply rate limiting
app.use('/api', globalLimiter);
app.use('/route', routeLimiter);
app.use('/geocode', geocodeLimiter);
```

### Setup Reverse Proxy (Recommended)

**Nginx:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:81;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Cache tiles
        location /tiles/ {
            proxy_pass http://localhost:81;
            proxy_cache_valid 200 7d;
            add_header X-Cache-Status $upstream_cache_status;
        }
    }
}
```

### Setup SSL (Production)

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com
```

## Storage Management

### Check Disk Space

```bash
# Overall disk usage
df -h

# Docker volumes
docker system df -v

# Nominatim database size
docker exec osrm-nominatim sudo -u postgres psql nominatim -c \
  "SELECT pg_size_pretty(pg_database_size('nominatim'));"
```

### Clean Up (if needed)

```bash
# Remove old containers
docker compose down

# Remove unused images
docker image prune -a

# Remove ALL volumes (WARNING: deletes all data!)
docker compose down -v
```

## Backup & Restore

### Backup Nominatim Database

```bash
# Backup
docker exec osrm-nominatim sudo -u postgres pg_dump nominatim | gzip > nominatim-backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip < nominatim-backup-20260130.sql.gz | docker exec -i osrm-nominatim sudo -u postgres psql nominatim
```

### Backup Data Files

```bash
# Backup ke external storage
tar -czf osrm-data-backup.tar.gz data/

# Atau rsync
rsync -avz data/ backup-server:/backups/osrm-data/
```

## Monitoring

### Resource Usage

```bash
# Real-time monitoring
docker stats

# Check specific container
docker stats osrm-nominatim
```

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f nominatim
docker compose logs -f osrm-tile-service

# Last 100 lines
docker compose logs --tail 100 nominatim
```

### Health Checks

```bash
# All services status
docker compose ps

# API health
curl http://localhost:81/health | jq .
```

## Troubleshooting

### Nominatim Import Stuck

```bash
# Check logs
docker compose logs --tail 100 nominatim

# Check PostgreSQL
docker exec osrm-nominatim sudo -u postgres psql nominatim -c "SELECT count(*) FROM planet_osm_ways;"

# Restart import (WARNING: deletes existing data)
docker compose down
docker volume rm osrm_service_nominatim-data osrm_service_nominatim-flatnode
docker compose up -d nominatim
```

### Out of Memory

```bash
# Check memory
free -h
docker stats --no-stream

# Reduce Nominatim threads
# Edit docker-compose.yml:
environment:
  - THREADS=2  # Reduce from 4
```

### Disk Full

```bash
# Check space
df -h

# Clean Docker
docker system prune -a --volumes

# Or clean specific volumes
docker volume ls
docker volume rm osrm_service_nominatim-flatnode
```

## Performance Tuning

### PostgreSQL (for large imports)

Edit PostgreSQL config in Nominatim container:

```bash
docker exec -it osrm-nominatim bash
nano /etc/postgresql/14/main/postgresql.conf

# Increase:
shared_buffers = 4GB
work_mem = 100MB
maintenance_work_mem = 2GB
```

### Nominatim Threads

More threads = faster import but more memory:

```yaml
nominatim:
  environment:
    - THREADS=8  # Use more CPU cores
```

## Auto-start on Boot

### Systemd Service (Linux)

Create `/etc/systemd/system/osrm-service.service`:

```ini
[Unit]
Description=OSRM Service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/osrm_service
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl enable osrm-service
sudo systemctl start osrm-service
```

## Cost Estimation

### Server Costs (VPS)

| Provider | Specs | Cost/month |
|----------|-------|------------|
| DigitalOcean | 8GB RAM, 160GB SSD | ~$48 |
| Vultr | 8GB RAM, 160GB SSD | ~$48 |
| Hetzner | 8GB RAM, 160GB SSD | ~€20 (~$22) |
| AWS EC2 | t3.large (8GB) | ~$60 |
| GCP | e2-standard-2 (8GB) | ~$50 |

### vs Cloud Geocoding APIs

| Service | Cost for 1M requests/month |
|---------|----------------------------|
| **Self-Hosted** | ~$50 (server only) |
| Google Geocoding | ~$5,000 |
| Mapbox Geocoding | ~$4,000 |
| **Savings** | **~$4,950/month (99%)** |

## Quick Commands Reference

```bash
# Start
docker compose up -d

# Stop
docker compose down

# Restart
docker compose restart

# Logs
docker compose logs -f nominatim

# Status
docker compose ps

# Update
git pull
docker compose build --no-cache
docker compose up -d

# Backup
docker exec osrm-nominatim sudo -u postgres pg_dump nominatim | gzip > backup.sql.gz

# Clean
docker system prune -a
```

## Next Steps After Deployment

1. ✅ Test all endpoints
2. ✅ Setup monitoring (Prometheus/Grafana)
3. ✅ Configure backups (cron job)
4. ✅ Setup SSL certificate
5. ✅ Configure firewall rules
6. ✅ Setup reverse proxy (Nginx)
7. ✅ Enable rate limiting
8. ✅ Configure auto-restart on failure

## Support

Jika ada masalah:
1. Check logs: `docker compose logs -f`
2. Check disk space: `df -h`
3. Check memory: `free -h`
4. Restart services: `docker compose restart`

Dokumentasi lengkap:
- [NOMINATIM-SETUP.md](NOMINATIM-SETUP.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [GEOCODING-QUICKSTART.md](GEOCODING-QUICKSTART.md)
