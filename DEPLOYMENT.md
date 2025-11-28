# 🚢 Production Deployment Guide

## Pre-requisites

- Linux server (Ubuntu 20.04/22.04 recommended)
- Docker & Docker Compose installed
- Minimal 8GB RAM
- Minimal 100GB storage
- Domain name (optional, untuk HTTPS)

## Deployment Steps

### 1. Prepare Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose -y

# Create user for deployment
sudo useradd -m -s /bin/bash osrm
sudo usermod -aG docker osrm
```

### 2. Upload Project

```bash
# Option A: Git clone
cd /home/osrm
git clone <your-repo-url> osrm_service
cd osrm_service

# Option B: SCP upload
# From local machine:
scp -r osrm_service/ user@server:/home/osrm/
```

### 3. Download & Process Data

```bash
cd /home/osrm/osrm_service

# Download Java OSM data
wget https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf \
  -O data/java-latest.osm.pbf

# Process for OSRM (20-30 minutes)
docker run -t -v "${PWD}/data:/data" osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

docker run -t -v "${PWD}/data:/data" osrm/osrm-backend \
  osrm-partition /data/java-latest.osrm

docker run -t -v "${PWD}/data:/data" osrm/osrm-backend \
  osrm-customize /data/java-latest.osrm
```

### 4. Environment Configuration

```bash
# Create production .env file
cat > .env << EOF
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://osm:CHANGE_THIS_PASSWORD@postgis:5432/osm
OSRM_URL=http://osrm-backend:5000
TILE_MODE=proxy
CACHE_DIR=/cache
EOF

# Secure permissions
chmod 600 .env
```

### 5. Docker Compose Configuration

Update `docker-compose.yml` for production:

```yaml
version: "3.8"

services:
  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    container_name: nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - tile-server
    restart: always
    networks:
      - osrm-network

  # API Server (2 replicas for load balancing)
  tile-server:
    build: .
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 2G
          cpus: "1.0"
    volumes:
      - ./data:/data:ro
      - ./cache:/cache
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - OSRM_URL=http://osrm-backend:5000
      - TILE_MODE=${TILE_MODE}
    depends_on:
      - osrm-backend
      - postgis
    restart: always
    networks:
      - osrm-network

  # OSRM Backend
  osrm-backend:
    image: osrm/osrm-backend:latest
    container_name: osrm-backend
    volumes:
      - ./data:/data:ro
    command: osrm-routed --algorithm mld /data/java-latest.osrm --max-table-size 10000
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "2.0"
    restart: always
    networks:
      - osrm-network

  # PostgreSQL + PostGIS
  postgis:
    image: postgis/postgis:15-3.3
    container_name: postgis
    environment:
      POSTGRES_DB: osm
      POSTGRES_USER: osm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgis-data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 4G
    restart: always
    networks:
      - osrm-network

networks:
  osrm-network:
    driver: bridge

volumes:
  postgis-data:
    driver: local
```

### 6. Nginx Configuration

```bash
mkdir -p nginx

cat > nginx/nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream api_servers {
        least_conn;
        server tile-server:8080;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=tile_limit:10m rate=100r/s;

    # Caching
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=tile_cache:100m
                     max_size=10g inactive=7d use_temp_path=off;

    server {
        listen 80;
        server_name your-domain.com;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        # Gzip compression
        gzip on;
        gzip_types application/json text/css application/javascript;

        # Static files
        location / {
            proxy_pass http://api_servers;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            limit_req zone=api_limit burst=20;
        }

        # Tiles endpoint with aggressive caching
        location /tiles/ {
            proxy_pass http://api_servers;
            proxy_cache tile_cache;
            proxy_cache_valid 200 7d;
            proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504;
            add_header X-Cache-Status $upstream_cache_status;
            limit_req zone=tile_limit burst=200;
        }

        # Health check (no rate limit)
        location /health {
            proxy_pass http://api_servers;
            access_log off;
        }
    }
}
EOF
```

### 7. SSL/HTTPS Setup (Optional but Recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
```

### 8. Start Services

```bash
# Build and start
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f tile-server
```

### 9. Import PostGIS Data (Optional)

```bash
# Wait for PostgreSQL to be ready
sleep 10

# Import OSM data to PostGIS (1-2 hours)
docker run --rm \
    --network osrm_service_osrm-network \
    -v "${PWD}/data:/data" \
    iboates/osm2pgsql:latest \
    osm2pgsql \
    --create --slim --drop \
    --cache 2000 \
    --number-processes 4 \
    --hstore \
    --style /usr/share/osm2pgsql/default.style \
    --multi-geometry \
    --host postgis \
    --port 5432 \
    --database osm \
    --username osm \
    --password ${POSTGRES_PASSWORD} \
    /data/java-latest.osm.pbf

# After import complete, switch to render mode
sed -i 's/TILE_MODE=proxy/TILE_MODE=render/' .env
docker-compose restart tile-server
```

### 10. Monitoring Setup

```bash
# Install monitoring tools
docker run -d --name prometheus \
  -p 9090:9090 \
  -v ${PWD}/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

docker run -d --name grafana \
  -p 3000:3000 \
  grafana/grafana
```

## Security Hardening

### 1. Firewall Configuration

```bash
# UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 2. Database Security

```bash
# Generate strong password
POSTGRES_PASSWORD=$(openssl rand -base64 32)

# Update .env file
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> .env

# Restart database
docker-compose restart postgis
```

### 3. API Authentication (TODO)

Add JWT or API key authentication to production deployment.

### 4. Regular Updates

```bash
# Update Docker images
docker-compose pull

# Rebuild and restart
docker-compose up -d --build

# Clean old images
docker image prune -a
```

## Backup Strategy

### 1. Database Backup

```bash
# Daily backup script
cat > /home/osrm/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec postgis pg_dump -U osm osm | gzip > /backups/db_$DATE.sql.gz
find /backups -name "db_*.sql.gz" -mtime +7 -delete
EOF

chmod +x /home/osrm/backup.sh

# Cron job (daily at 2 AM)
echo "0 2 * * * /home/osrm/backup.sh" | crontab -
```

### 2. Data Backup

```bash
# Backup OSRM processed data
tar -czf data-backup.tar.gz data/*.osrm*

# Upload to cloud storage
# aws s3 cp data-backup.tar.gz s3://your-bucket/
```

## Performance Tuning

### 1. PostgreSQL Tuning

Edit `docker-compose.yml`:

```yaml
postgis:
  environment:
    POSTGRES_SHARED_BUFFERS: 2GB
    POSTGRES_EFFECTIVE_CACHE_SIZE: 6GB
    POSTGRES_WORK_MEM: 50MB
    POSTGRES_MAINTENANCE_WORK_MEM: 512MB
```

### 2. OSRM Tuning

```yaml
osrm-backend:
  command: >
    osrm-routed
    --algorithm mld
    --max-table-size 10000
    --max-matching-size 1000
    /data/java-latest.osrm
```

### 3. Node.js Tuning

```yaml
tile-server:
  environment:
    - NODE_OPTIONS=--max-old-space-size=1536
```

## Monitoring Checklist

- [ ] API response times < 100ms (median)
- [ ] CPU usage < 70%
- [ ] Memory usage < 80%
- [ ] Disk usage < 80%
- [ ] Cache hit rate > 80%
- [ ] Error rate < 1%
- [ ] Uptime > 99.9%

## Troubleshooting

### High Memory Usage

```bash
# Check container stats
docker stats

# Restart containers
docker-compose restart
```

### Slow Queries

```bash
# Check PostgreSQL logs
docker logs postgis | grep "slow query"

# Add indexes
docker exec -it postgis psql -U osm -c "CREATE INDEX idx_way ON planet_osm_line USING GIST(way);"
```

### OSRM Not Responding

```bash
# Check logs
docker logs osrm-backend

# Verify data files
ls -lh data/*.osrm*

# Restart
docker-compose restart osrm-backend
```

---

**Production Checklist:**

- [ ] SSL/HTTPS configured
- [ ] Firewall enabled
- [ ] Strong passwords
- [ ] Backups configured
- [ ] Monitoring setup
- [ ] Logs centralized
- [ ] Rate limiting active
- [ ] CORS restricted
