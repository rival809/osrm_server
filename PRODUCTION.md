# Production Deployment

Production-ready deployment dengan Nginx, load balancing, SSL, dan monitoring.

## Architecture

```
Internet → [Nginx] :80/443 → [API-1] [API-2] :8080 → [OSRM] :5000
```

**Components:**

- **Nginx**: Reverse proxy, load balancer, rate limiting, caching
- **API Instances**: 2x Node.js servers for redundancy
- **OSRM Backend**: Routing engine with Java Island data
- **Volumes**: Persistent cache, logs, SSL certificates

## Quick Deploy

### 1. Server Setup (Ubuntu)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Clone project
cd /opt
git clone <repo-url> osrm-service
cd osrm-service
```

### 2. Process Data

```bash
# Run automated setup
./MASTER-SETUP.sh

# This will:
# - Download Java OSM data (800MB)
# - Process OSRM files (10-20 min)
# - Setup environment
```

### 3. Deploy Services

```bash
# One-command deployment
./deploy-production.sh

# Or manual:
docker-compose up -d --build

# Check status
docker-compose ps
curl http://localhost/health
```

### 4. Configure SSL (Optional)

```bash
# Install Certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/

# Update nginx.conf (uncomment SSL server block)
# Then restart
docker-compose restart nginx
```

## Management

### Service Control

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# Status
docker-compose ps

# Logs
docker-compose logs -f [service]
```

### Monitoring

```bash
# Health check
curl http://localhost/health

# Test routing
curl "http://localhost/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753"

# Container stats
docker stats

# Cache stats
curl http://localhost/cache/stats
```

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and deploy
docker-compose build --no-cache
docker-compose up -d

# Zero-downtime update
docker-compose up -d --no-deps --build osrm-api-1
docker-compose up -d --no-deps --build osrm-api-2
```

## Configuration

### Environment Variables (.env)

```bash
NODE_ENV=production
PORT=8080
OSRM_URL=http://osrm-backend:5000
CACHE_DIR=/app/cache
MAX_CACHE_SIZE_MB=2000
TILE_CACHE_TTL=604800000
```

### Resource Limits

Edit `docker-compose.yml`:

```yaml
services:
  osrm-backend:
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "2.0"

  osrm-api-1:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "1.0"
```

For higher load, use `docker-compose.prod.yml`:

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Nginx Configuration

Key settings in `nginx/nginx.conf`:

```nginx
# Load balancing
upstream osrm_api {
    least_conn;
    server osrm-api-1:8080;
    server osrm-api-2:8080;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=route_limit:10m rate=10r/s;

# Caching
proxy_cache_path /var/cache/nginx/tiles levels=1:2
                 keys_zone=tile_cache:100m max_size=5g
                 inactive=7d use_temp_path=off;
```

## Security

### Firewall

```bash
# UFW
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### SSL/HTTPS

**Let's Encrypt (Production):**

```bash
# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Auto-renewal
echo "0 0 * * * certbot renew --quiet" | sudo crontab -
```

**Self-Signed (Development):**

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

### Updates

```bash
# System updates
sudo apt update && sudo apt upgrade -y

# Docker images
docker-compose pull
docker-compose up -d --build
```

## Backup

### Automated Backup

```bash
# Create backup script
cat > /opt/osrm-service/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/osrm"
DATE=$(date +%Y%m%d)

mkdir -p $BACKUP_DIR

# Backup data
tar -czf $BACKUP_DIR/data-$DATE.tar.gz data/*.osrm*

# Backup config
tar -czf $BACKUP_DIR/config-$DATE.tar.gz nginx/ .env docker-compose*.yml

# Cleanup old backups (7 days)
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x backup.sh

# Schedule daily (2 AM)
echo "0 2 * * * /opt/osrm-service/backup.sh" | crontab -
```

### Restore

```bash
# Restore data
tar -xzf data-YYYYMMDD.tar.gz -C /opt/osrm-service/

# Restart
cd /opt/osrm-service
docker-compose restart
```

## Monitoring

### Logs

```bash
# View all logs
docker-compose logs -f

# Specific service
docker-compose logs -f nginx
docker-compose logs -f osrm-api-1

# Export logs
docker-compose logs --no-color > logs/app-$(date +%Y%m%d).log
```

### Performance

```bash
# Container stats
docker stats --no-stream

# Response times
time curl -s http://localhost/route/v1/driving/106.8,-6.2;106.9,-6.1

# Cache hit rate
docker-compose logs nginx | grep "X-Cache-Status" | tail -100
```

### Health Checks

All services have built-in health checks:

```bash
# Check health
docker-compose ps

# Manual check
curl http://localhost/health
curl http://localhost:5000/route/v1/driving/106.8,-6.2;106.9,-6.1
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs [service]

# Check disk space
df -h

# Check memory
free -h

# Restart
docker-compose restart [service]
```

### High Memory Usage

```bash
# Check usage
docker stats

# Reduce cache size in .env
MAX_CACHE_SIZE_MB=1000

# Restart
docker-compose restart
```

### Slow Response

```bash
# Check OSRM
time curl http://localhost:5000/route/v1/driving/106.8,-6.2;106.9,-6.1

# Check Nginx cache
docker-compose logs nginx | grep HIT

# Preload cache
./CACHE-MANAGER.sh
```

### SSL Issues

```bash
# Check certificate
openssl x509 -in nginx/ssl/fullchain.pem -text -noout

# Test SSL
curl -I https://your-domain.com

# Renew certificate
sudo certbot renew
docker-compose restart nginx
```

## Performance Tuning

### Server Specs by Load

| Traffic            | vCPU | RAM   | Disk   | API Instances |
| ------------------ | ---- | ----- | ------ | ------------- |
| Low (<100 req/min) | 2    | 8GB   | 50GB   | 1-2           |
| Medium (100-1000)  | 4    | 16GB  | 100GB  | 2-3           |
| High (>1000)       | 8+   | 32GB+ | 200GB+ | 4+            |

### Optimization

```bash
# Use production compose
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Preload cache
./CACHE-MANAGER.sh
# Select option 2

# Monitor cache hit rate (target >80%)
docker-compose logs nginx | grep "X-Cache-Status" | grep HIT | wc -l
```

## Production Checklist

**Pre-Deploy:**

- [ ] OSRM data processed
- [ ] Environment variables configured
- [ ] SSL certificates obtained
- [ ] Firewall configured
- [ ] Backup script scheduled
- [ ] Resource limits tuned

**Post-Deploy:**

- [ ] All services healthy
- [ ] SSL working
- [ ] Logs clean
- [ ] Cache working
- [ ] Backup tested
- [ ] Monitoring active

## AWS Deployment

### EC2 Instance

**Recommended:**

- Instance: t3.xlarge or larger
- OS: Ubuntu 22.04 LTS
- Storage: 100GB+ SSD
- Security Group: Allow 22, 80, 443

**Setup:**

```bash
# Connect to EC2
ssh -i key.pem ubuntu@ec2-ip

# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone & deploy
cd /opt
git clone <repo> osrm-service
cd osrm-service
./MASTER-SETUP.sh
./deploy-production.sh

# Configure domain
# Point A record to EC2 elastic IP
# Setup SSL with certbot
```

### ECS Deployment

Use `docker-compose.yml` as base for ECS task definition. Key points:

- Use EFS for persistent cache
- Use ALB for load balancing
- Use CloudWatch for logs
- Use RDS for session storage (optional)

See AWS ECS documentation for details.

## Support

**Logs:** `docker-compose logs -f`  
**Status:** `docker-compose ps`  
**Health:** `curl http://localhost/health`

For issues, check logs first, then review troubleshooting section.
