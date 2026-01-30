# 🎯 Quick Reference - Deploy ke Server

## 📋 Yang Sudah Siap

✅ Docker-compose sudah fix (Nominatim bisa jalan)  
✅ Geocoding endpoints sudah ada di `src/server.js`  
✅ Dokumentasi lengkap tersedia  
✅ Test script tersedia (`npm run test:geocoding`)

## 🖥️ Server Requirements

| Resource    | Minimum | Recommended    |
| ----------- | ------- | -------------- |
| **RAM**     | 8GB     | **16GB** ⭐    |
| **Storage** | 30GB    | **50GB** ⭐    |
| **CPU**     | 2 cores | **4 cores** ⭐ |

**Storage Breakdown:**

- Data files: ~4GB
- **Nominatim DB: ~20GB** (yang paling besar!)
- Docker images: ~5GB
- Buffer: ~5GB

## 🚀 Deploy Steps (30 menit + 2-4 jam import)

### 1. Transfer ke Server

```bash
# Option A: Via Git (recommended)
git push origin main
# Di server:
git clone <repo-url> osrm_service

# Option B: Via rsync (jika sudah ada data)
rsync -avz osrm_service/ user@server:/home/user/osrm_service/
```

### 2. Di Server - Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get install docker-compose-plugin

# Verify
docker --version
docker compose version
```

### 3. Start Services

```bash
cd osrm_service

# Build & Start
docker compose build --no-cache
docker compose up -d

# Check status
docker compose ps
```

### 4. Monitor Nominatim Import (Ini yang lama: 2-4 jam)

```bash
# Watch logs real-time
docker compose logs -f nominatim

# Atau check status setiap 10 menit
watch -n 600 'curl -s http://localhost:5002/status.php?format=json'

# Status: 0 = Ready ✅
# Status: 700-705 = Masih import ⏳
```

**Progress indicator:**

```
00:00 - Start
00:10 - Loading data (fase 1)
01:00 - Indexing (fase 2)
03:00 - Optimization (fase 3)
04:00 - Done! ✅
```

### 5. Test (Setelah import selesai)

```bash
# Health check
curl http://localhost:81/health | jq .

# Test geocoding
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191" | jq .

# Test routing
curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722" | jq .
```

## 📝 Important Notes

### Nominatim Import:

- ⏱️ **Time:** 2-4 hours (normal untuk Java Island)
- 💾 **Storage:** ~20GB untuk database
- 🔄 **One-time only:** Setelah import, restart cepat (database tersimpan di volume)
- ⚠️ **Jangan panic** jika terlihat stuck - check logs untuk melihat progress

### Jika Import Gagal:

```bash
# Restart fresh (hapus data lama)
docker compose down -v
docker compose up -d
```

### Check Disk Space:

```bash
df -h
docker system df -v
```

### Monitor Resources:

```bash
docker stats
free -h
```

## 🔧 Setelah Jalan

1. **Setup Nginx** (reverse proxy)
2. **Setup SSL** (certbot)
3. **Enable Rate Limiting** (edit src/server.js)
4. **Setup Backups** (cron job)
5. **Configure Auto-start** (systemd)

Lihat [SERVER-DEPLOYMENT.md](SERVER-DEPLOYMENT.md) untuk detail lengkap.

## ⚡ Quick Commands

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

# Check import
curl http://localhost:5002/status.php?format=json
```

## 🆘 Troubleshooting

| Issue                  | Fix                                         |
| ---------------------- | ------------------------------------------- |
| Nominatim restart loop | Check logs: `docker compose logs nominatim` |
| Out of memory          | Reduce threads di docker-compose.yml        |
| Disk full              | Clean: `docker system prune -a`             |
| Port tidak accessible  | Check firewall: `sudo ufw allow 81`         |

## 📚 Full Documentation

- **Quick:** [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) - Step-by-step checklist
- **Complete:** [SERVER-DEPLOYMENT.md](SERVER-DEPLOYMENT.md) - Detailed guide
- **Geocoding:** [NOMINATIM-SETUP.md](NOMINATIM-SETUP.md) - Nominatim specific

## 💰 Cost Estimate

**VPS (16GB RAM, 50GB SSD):**

- Hetzner: €20/month (~$22) ⭐ Cheapest
- DigitalOcean: $48/month
- Vultr: $48/month

**vs Google Geocoding:**

- Self-hosted: $22/month
- Google: $5,000/month (1M requests)
- **Savings: 99%** 🎉

## ✅ Success Checklist

Deploy berhasil jika:

- [ ] All containers status "Up" dan "healthy"
- [ ] Health check returns `{"status": "ok"}`
- [ ] Nominatim status returns `{"status": 0}`
- [ ] Geocoding test returns proper address
- [ ] Routing test returns route
- [ ] Memory usage stable < 80%
- [ ] No restart loops

---

**Ready to deploy?**

1. Push code ke Git
2. Follow [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md)
3. Wait 2-4 hours for Nominatim import
4. Test & Done! 🎉
