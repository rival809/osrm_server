# 🚀 Production Deployment Guide - Docker Best Practices

## Architecture Overview

```
Internet
    ↓
[Nginx] (Port 80/443) - Reverse Proxy & Load Balancer
    ↓ (Load Balance)
[API-1] [API-2] (Port 8080) - Node.js API + File Cache
    ↓ (Internal Network)
[OSRM Backend] (Port 5000) - Routing Engine
```

**Features:**

- ✅ Nginx reverse proxy with rate limiting & caching
- ✅ 2x API server instances (load balanced)
- ✅ Health checks for all services
- ✅ Resource limits & reservations
- ✅ Auto-restart on failure
- ✅ Centralized logging
- ✅ Security headers

---

## Quick Start (5 Minutes)

### 1. Initial Setup

```bash
# Clone or upload project to server
cd /opt
git clone <your-repo> osrm-service
cd osrm-service

# Create required directories
mkdir -p cache logs nginx/ssl data

# Set permissions
chmod -R 755 cache logs
```

### 2. Deploy Services

```bash
# Build and start all services
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Verify Deployment

```bash
# Check health
curl http://localhost/health

# Test routing
curl "http://localhost/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753"

# Test tile serving
curl -I "http://localhost/tiles/10/511/511.png"
```

**✅ Done!** Service is now running on port 80.

---

## Production Deployment

### Prerequisites

**Server Requirements:**

- Ubuntu 20.04/22.04 or similar
- Docker Engine 20.10+
- Docker Compose 2.0+
- Minimum 8GB RAM (16GB recommended)
- Minimum 50GB disk space
- Public IP / Domain name

**Install Docker:**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose V2
sudo apt install docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### Step 1: Clone & Configure

```bash
# Navigate to deployment directory
cd /opt
git clone <your-repo> osrm-service
cd osrm-service

# Create environment file
cat > .env << EOF
NODE_ENV=production
PORT=8080
OSRM_URL=http://osrm-backend:5000
CACHE_DIR=/app/cache
CACHE_MODE=smart
MAX_CACHE_SIZE_MB=2000
TILE_CACHE_TTL=604800000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF

# Secure permissions
chmod 600 .env
```

### Step 2: Process OSRM Data

If data not yet processed, run:

```bash
# Run master setup
./MASTER-SETUP.sh

# Or manual processing:
# 1. Download
wget https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf \
  -O data/java-latest.osm.pbf

# 2. Process (20-30 minutes)
docker run -t -v "$(pwd)/data:/data" \
  ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

docker run -t -v "$(pwd)/data:/data" \
  ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-partition /data/java-latest.osrm

docker run -t -v "$(pwd)/data:/data" \
  ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-customize /data/java-latest.osrm
```

### Step 3: Deploy with Docker Compose

```bash
# Build images
docker-compose build --no-cache

# Start services
docker-compose up -d

# For production with optimized settings
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Monitor startup
docker-compose logs -f
```

### Step 4: Setup SSL/HTTPS

**Option A: Let's Encrypt (Recommended)**

```bash
# Install Certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/

# Update nginx.conf to add SSL server block (see SSL section below)

# Reload nginx
docker-compose restart nginx

# Auto-renewal
sudo crontab -e
# Add: 0 0 * * * certbot renew --quiet && docker-compose restart nginx
```

**Option B: Self-Signed (Development)**

```bash
# Generate certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

**SSL Nginx Configuration:**

Add this to `nginx/nginx.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # ... rest of location blocks same as port 80
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Step 5: Configure Firewall

```bash
# UFW Firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# Check status
sudo ufw status
```

---

## Management Commands

### Service Control

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View status
docker-compose ps

# View logs
docker-compose logs -f [service-name]

# Tail specific service
docker-compose logs -f osrm-api-1
docker-compose logs -f nginx
```

### Scaling

```bash
# Scale API servers
docker-compose up -d --scale osrm-api-1=3 --scale osrm-api-2=3

# Scale down
docker-compose up -d --scale osrm-api-1=1 --scale osrm-api-2=1
```

### Updates & Maintenance

```bash
# Pull latest code
git pull origin main

# Rebuild images
docker-compose build --no-cache

# Deploy new version (zero-downtime)
docker-compose up -d --no-deps --build osrm-api-1
docker-compose up -d --no-deps --build osrm-api-2

# Rollback
git checkout <previous-commit>
docker-compose up -d --build
```

### Health Monitoring

```bash
# Check all services health
docker-compose ps

# Test endpoints
curl http://localhost/health
curl http://localhost/route/v1/driving/106.8,-6.2;106.9,-6.1

# Container stats
docker stats

# Detailed inspection
docker inspect osrm-backend
```

---

## Monitoring & Logging

### Log Management

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f osrm-api-1

# Export logs
docker-compose logs --no-color > logs/deployment-$(date +%Y%m%d).log

# Log rotation (add to crontab)
echo "0 0 * * * docker-compose logs --no-color --tail 10000 > /opt/osrm-service/logs/app-\$(date +\%Y\%m\%d).log" | crontab -
```

### Performance Monitoring

```bash
# Container resource usage
docker stats --no-stream

# Nginx cache stats
docker exec osrm-nginx find /var/cache/nginx -type f | wc -l

# API response times (sample)
time curl -s http://localhost/route/v1/driving/106.8,-6.2;106.9,-6.1 > /dev/null
```

### Prometheus + Grafana (Optional)

```bash
# Add to docker-compose.yml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

---

## Backup & Recovery

### Automated Backup Script

```bash
# Create backup script
cat > /opt/osrm-service/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/osrm"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup OSRM data
tar -czf $BACKUP_DIR/osrm-data-$DATE.tar.gz \
  /opt/osrm-service/data/*.osrm*

# Backup cache
tar -czf $BACKUP_DIR/osrm-cache-$DATE.tar.gz \
  /opt/osrm-service/cache

# Backup configs
tar -czf $BACKUP_DIR/osrm-config-$DATE.tar.gz \
  /opt/osrm-service/nginx \
  /opt/osrm-service/.env \
  /opt/osrm-service/docker-compose*.yml

# Delete old backups (keep 7 days)
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /opt/osrm-service/backup.sh

# Schedule daily backup (2 AM)
echo "0 2 * * * /opt/osrm-service/backup.sh >> /var/log/osrm-backup.log 2>&1" | sudo crontab -
```

### Recovery

```bash
# Restore data
tar -xzf osrm-data-YYYYMMDD_HHMMSS.tar.gz -C /

# Restart services
cd /opt/osrm-service
docker-compose down
docker-compose up -d
```

---

## Security Hardening

### 1. Container Security

```bash
# Run security scan
docker scan osrm-service_osrm-api-1

# Update base images regularly
docker-compose pull
docker-compose up -d --build
```

### 2. Network Security

```bash
# Restrict external access to internal services
# Already configured in docker-compose.yml - only nginx exposed

# Check exposed ports
docker-compose ps
netstat -tlnp | grep docker
```

### 3. API Authentication (TODO)

Implement JWT or API key authentication in production:

```javascript
// Add to src/server.js
const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP",
});

app.use("/route/", apiLimiter);
```

### 4. Regular Updates

```bash
# Weekly security updates
sudo apt update && sudo apt upgrade -y
docker-compose pull
docker-compose up -d --build

# Check for vulnerabilities
docker scan osrm-service_osrm-api-1:latest
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs [service-name]

# Check disk space
df -h

# Check memory
free -h

# Restart specific service
docker-compose restart [service-name]
```

### High Memory Usage

```bash
# Check stats
docker stats

# Reduce cache size in .env
MAX_CACHE_SIZE_MB=1000

# Restart services
docker-compose restart
```

### Slow Response Times

```bash
# Check Nginx cache hit rate
docker-compose logs nginx | grep "X-Cache-Status"

# Check OSRM backend
time curl http://localhost:5000/route/v1/driving/106.8,-6.2;106.9,-6.1

# Increase Nginx cache
# Edit nginx/nginx.conf, increase max_size
```

### Data Corruption

```bash
# Re-process OSRM data
rm -rf data/*.osrm*
./MASTER-SETUP.sh

# Or manually:
docker run -t -v "$(pwd)/data:/data" \
  ghcr.io/project-osrm/osrm-backend:v6.0.0 \
  osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
# ... continue with partition & customize
```

---

## Performance Tuning

### Recommended Server Specs by Load

**Low Traffic (<100 req/min):**

- 2 vCPU, 8GB RAM
- 1 API instance
- 50GB SSD

**Medium Traffic (100-1000 req/min):**

- 4 vCPU, 16GB RAM
- 2 API instances
- 100GB SSD

**High Traffic (>1000 req/min):**

- 8+ vCPU, 32GB+ RAM
- 4+ API instances
- 200GB+ SSD
- CDN for static tiles

### Optimization Checklist

- [ ] Enable all Nginx caching layers
- [ ] Preload cache on startup
- [ ] Use production docker-compose.prod.yml
- [ ] Monitor cache hit rates (target >80%)
- [ ] Tune resource limits per load
- [ ] Enable HTTP/2
- [ ] Use CDN for tile serving
- [ ] Implement API key auth

---

## Production Checklist

**Pre-Launch:**

- [ ] OSRM data processed completely
- [ ] All services health checks passing
- [ ] SSL/HTTPS configured
- [ ] Firewall configured
- [ ] Backup script scheduled
- [ ] Monitoring setup
- [ ] Log rotation configured
- [ ] Resource limits tuned
- [ ] Load testing completed
- [ ] Documentation updated

**Post-Launch:**

- [ ] Monitor logs for errors
- [ ] Check cache hit rates
- [ ] Verify auto-restart works
- [ ] Test backup restoration
- [ ] Monitor disk usage
- [ ] Check memory usage
- [ ] Review access logs
- [ ] Update DNS if needed

---

## Support & Resources

**Logs Location:**

- Nginx: `docker-compose logs nginx`
- API: `docker-compose logs osrm-api-1`
- OSRM: `docker-compose logs osrm-backend`

**Configuration Files:**

- Main: `docker-compose.yml`
- Nginx: `nginx/nginx.conf`
- Environment: `.env`

**Useful Commands:**

```bash
# Quick status check
docker-compose ps && curl -s http://localhost/health | jq

# Full system check
docker stats --no-stream && df -h && free -h

# Emergency restart
docker-compose down && docker-compose up -d
```

---

**🎉 Your OSRM service is now production-ready!**

For issues or questions, check logs first, then review this guide.
