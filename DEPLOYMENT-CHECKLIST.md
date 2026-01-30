# ✅ Server Deployment Checklist

## Pre-Deployment (Di PC Lokal)

- [x] Docker-compose.yml sudah fix (Nominatim writable mount)
- [x] Source code sudah siap dengan geocoding endpoints
- [x] Dokumentasi lengkap tersedia
- [ ] Push code ke Git repository (untuk easy transfer)

## Server Preparation

- [ ] Server dengan specs minimum:
  - RAM: 16GB (recommended untuk Nominatim)
  - Storage: 40GB+ free space
  - CPU: 4+ cores
  - OS: Ubuntu 20.04+ / Debian 11+

- [ ] Install Docker & Docker Compose:
  ```bash
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo apt-get install docker-compose-plugin
  ```

- [ ] Open firewall ports:
  ```bash
  sudo ufw allow 80/tcp    # HTTP
  sudo ufw allow 443/tcp   # HTTPS
  sudo ufw allow 81/tcp    # OSRM API (optional, jika tidak pakai reverse proxy)
  ```

## Transfer Files ke Server

Option 1 - Via Git (Recommended):
```bash
# Di server
git clone <your-repo-url> osrm_service
cd osrm_service
```

Option 2 - Via rsync:
```bash
# Di PC lokal
rsync -avz --progress d:\Kerja\osrm_service/ user@server-ip:/home/user/osrm_service/
```

Option 3 - Manual transfer data files only:
```bash
# Transfer hanya data directory (jika code sudah ada via git)
rsync -avz --progress d:\Kerja\osrm_service\data/ user@server-ip:/home/user/osrm_service/data/
```

## Server Deployment Steps

1. **Login ke Server**
   ```bash
   ssh user@your-server-ip
   cd osrm_service
   ```

2. **Verify Data Files**
   ```bash
   ls -lh data/
   # Harus ada:
   # - java-latest.osm.pbf (~850MB)
   # - java-latest.osrm.* (26 files)
   # - java.mbtiles (~2GB)
   ```

3. **Build & Start Services**
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

4. **Monitor Nominatim Import (2-4 jam)**
   ```bash
   # Watch logs (real-time)
   docker compose logs -f nominatim
   
   # Check import status setiap 10 menit
   watch -n 600 'curl -s http://localhost:5002/status.php?format=json | jq .'
   ```

5. **Wait for Import to Complete**
   - Status: 0 = Ready
   - Status: 700-705 = Still importing
   - Time: 2-4 hours untuk Java Island

6. **Test Semua Endpoints**
   ```bash
   # Health check
   curl http://localhost:81/health | jq .
   
   # Routing
   curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722" | jq .
   
   # Reverse geocoding
   curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191" | jq .
   
   # Forward geocoding
   curl "http://localhost:81/geocode/search?q=Bandung" | jq .
   ```

## Post-Deployment (Production Setup)

- [ ] Setup Nginx reverse proxy
  ```bash
  sudo apt-get install nginx
  sudo nano /etc/nginx/sites-available/osrm
  ```

- [ ] Setup SSL certificate
  ```bash
  sudo apt-get install certbot python3-certbot-nginx
  sudo certbot --nginx -d your-domain.com
  ```

- [ ] Configure auto-start on boot
  ```bash
  # Systemd service (lihat SERVER-DEPLOYMENT.md)
  sudo systemctl enable osrm-service
  ```

- [ ] Setup monitoring
  - [ ] Prometheus + Grafana (optional)
  - [ ] Basic monitoring via `docker stats`

- [ ] Configure backups
  ```bash
  # Cron job untuk backup Nominatim DB
  0 2 * * 0 docker exec osrm-nominatim sudo -u postgres pg_dump nominatim | gzip > /backups/nominatim-$(date +\%Y\%m\%d).sql.gz
  ```

- [ ] Enable rate limiting
  - Edit `src/server.js` (uncomment rate limiter)
  - Rebuild: `docker compose up --build -d osrm-tile-service`

- [ ] Setup alerts (optional)
  - Disk space monitoring
  - Memory usage alerts
  - Service down alerts

## Testing Checklist

Setelah semua jalan:

- [ ] Test routing dari berbagai koordinat
- [ ] Test reverse geocoding (koordinat → nama)
- [ ] Test forward geocoding (nama → koordinat)
- [ ] Test map tiles loading
- [ ] Load test dengan ab atau wrk
- [ ] Monitor memory usage (24 jam)
- [ ] Monitor disk space (weekly)

## Maintenance Schedule

**Daily:**
- [ ] Check `docker compose ps`
- [ ] Check logs untuk error

**Weekly:**
- [ ] Review disk space: `df -h`
- [ ] Review memory: `free -h`
- [ ] Clean docker: `docker system prune`

**Monthly:**
- [ ] Update PBF data (jika perlu data terbaru)
- [ ] Backup Nominatim database
- [ ] Review performance metrics

**Quarterly:**
- [ ] Update Docker images
- [ ] Security patches
- [ ] Performance optimization

## Expected Import Timeline

```
00:00 - Start containers
00:05 - PostgreSQL ready
00:10 - Nominatim starts import
00:30 - Phase 1: Loading data (30-60 min)
01:30 - Phase 2: Indexing (60-120 min)
03:00 - Phase 3: Optimization (30-60 min)
04:00 - Import complete! ✅
```

Monitor dengan:
```bash
docker compose logs -f nominatim | grep -i "phase\|import\|index\|done"
```

## Storage Breakdown

Total needed: ~40GB

| Component | Size |
|-----------|------|
| PBF file | 850MB |
| OSRM files | 1.5GB |
| MBTiles | 2GB |
| **Nominatim DB** | **15-20GB** ⚠️ |
| PostgreSQL overhead | 5GB |
| Docker images | 5GB |
| System + logs | 5GB |
| Buffer | 5GB |

## Quick Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart single service
docker compose restart nominatim

# Check status
docker compose ps

# View logs
docker compose logs -f nominatim

# Check disk space
df -h

# Check memory
free -h

# Docker stats
docker stats --no-stream

# Nominatim status
curl http://localhost:5002/status.php?format=json

# Health check
curl http://localhost:81/health
```

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| Nominatim keeps restarting | Check logs: `docker compose logs nominatim` |
| Import stuck | Wait longer (2-4h normal), check PostgreSQL: `docker stats` |
| Out of memory | Reduce threads in docker-compose.yml |
| Disk full | Clean docker: `docker system prune -a` |
| Port 81 not accessible | Check firewall: `sudo ufw status` |
| Geocoding returns 500 | Nominatim not ready yet, check status endpoint |

## Success Criteria

✅ Deployment sukses jika:
1. `docker compose ps` shows all containers healthy
2. `curl http://localhost:81/health` returns status: "ok"
3. Nominatim status returns `{"status": 0}`
4. Test geocoding returns proper results
5. No restart loops in `docker compose ps`
6. Memory usage stable < 80%
7. Disk usage < 80%

## Contact & Support

Jika stuck:
1. Check [SERVER-DEPLOYMENT.md](SERVER-DEPLOYMENT.md) - Full guide
2. Check [NOMINATIM-SETUP.md](NOMINATIM-SETUP.md) - Nominatim specific
3. Check logs: `docker compose logs -f`
4. Check GitHub issues

---

**Note:** Nominatim import butuh **2-4 jam** dan **~20GB storage**. Ini normal untuk Java Island dataset. Jangan panic jika terlihat stuck - monitor logs untuk melihat progress.

**Recommendation:** Gunakan server dengan minimum 16GB RAM dan 50GB storage untuk comfortable operation.
