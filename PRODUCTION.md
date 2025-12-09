# Production Deployment

Production-ready deployment untuk OSRM routing service sebagai **internal microservice**.

## Architecture

**Recommended: Backend Sambara Gateway Pattern**

```
User (Mobile/Web)
    ↓ HTTPS (Public Internet)
[Backend Sambara] - API Gateway
    ↓ HTTP (Private Network/VPC)
[OSRM Service - Nginx] :80
    ↓
[API-1] [API-2] :8080
    ↓
[OSRM Backend] :5000
```

**Direct Internal Access (Alternative):**

```
Internal Services/VPC
    ↓ HTTP (Private Network)
[Nginx] :80 → [API-1] [API-2] :8080 → [OSRM] :5000
```

**Components:**

- **Nginx**: Reverse proxy, load balancer, rate limiting (Port 80 - HTTP only)
- **API Instances**: 2x Node.js servers for redundancy (Internal port 8080)
- **OSRM Backend**: Routing engine with Java Island data (Internal port 5000)
- **Volumes**: Persistent cache for map tiles, logs
- **SSL**: Not required - handled by Backend Sambara/API Gateway

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

### 2. Configure Swap Memory (Recommended)

```bash
# Check existing swap
sudo swapon --show
free -h

# Create 4GB swap file (if not exists or too small)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent (add to /etc/fstab)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Optimize swap usage (optional)
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

# Verify
free -h
```

**Why Swap?**

- Prevents OOM (Out of Memory) kills during OSRM processing
- Provides buffer for memory spikes
- Improves system stability under load
- Recommended: 4GB swap for 8GB RAM servers

### 3. Process Data

```bash
# Run automated setup
./MASTER-SETUP.sh

# This will:
# - Download Java OSM data (800MB)
# - Process OSRM files (10-20 min)
# - Setup environment
```

### 4. Deploy Services

**Choose deployment mode based on server specs:**

```bash
# Development mode (8GB RAM servers)
docker-compose build --no-cache
docker-compose up -d

# Production mode (2+ vCPU, 8GB+ RAM servers)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Check status
docker-compose ps
curl http://localhost/health
```

**Note:** This deployment uses **HTTP only (port 80)** as it's designed for internal network/VPC access where SSL is handled at load balancer level or not required.

### 5. Configure Firewall (Important!)

**For Backend Sambara Gateway Pattern:**

```bash
# Allow access ONLY from Backend Sambara server
sudo ufw allow from <BACKEND_SAMBARA_IP> to any port 80 proto tcp

# Or allow from entire VPC CIDR
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp

# Allow SSH for admin access
sudo ufw allow from <ADMIN_IP> to any port 22 proto tcp

# Deny all other access
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Enable firewall
sudo ufw enable
sudo ufw status
```

**AWS Security Group Configuration:**

```yaml
Inbound Rules:
  - Type: Custom TCP
    Port: 80
    Source: <Backend-Sambara-Security-Group-ID>
    Description: "HTTP from Backend Sambara only"

  - Type: SSH
    Port: 22
    Source: <Admin-IP>/32
    Description: "Admin access"

Outbound Rules:
  - Type: All traffic
    Destination: 0.0.0.0/0
    Description: "Allow outbound for updates"
```

**Verify Configuration:**

```bash
# Test from Backend Sambara server
curl http://<OSRM_INTERNAL_IP>/health

# Should work ✓

# Test from other server/internet
curl http://<OSRM_INTERNAL_IP>/health

# Should timeout/reject ✓
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
TILE_CACHE_TTL=180000
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

**For Internal/VPC Deployment:**

```bash
# UFW - Restrict to internal network only
sudo ufw allow 22/tcp   # SSH (restrict to your IP)
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp   # HTTP from VPC only
sudo ufw enable

# Or for AWS Security Groups:
# - Port 22: Your IP only
# - Port 80: VPC CIDR (e.g., 172.31.0.0/16)
# - Port 443: Not needed for internal
```

**For Public Deployment:**

```bash
# UFW - Open to internet
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS (if using SSL)
sudo ufw enable
```

### SSL/HTTPS

**Not Required for Internal Deployment** ✅

If your services are accessed within:

- Same VPC/private network
- Behind AWS ALB with SSL termination
- Internal microservice communication
- Mobile app → API Gateway → OSRM service

Then **SSL is not needed** at OSRM service level.

**Optional for Direct Public Access:**

**Let's Encrypt (Production):**

```bash
# Only if exposing directly to internet
sudo certbot certonly --standalone -d your-domain.com

# Auto-renewal
echo "0 0 * * * certbot renew --quiet" | sudo crontab -
```

**Self-Signed (Development):**

```bash
# For local testing only
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

- [ ] OSRM data processed (26 files)
- [ ] Environment variables configured
- [ ] Firewall/Security Group configured (Port 80 from VPC only)
- [ ] Backup script scheduled
- [ ] Resource limits tuned (use docker-compose.prod.yml for 16GB RAM)
- [ ] ~~SSL certificates~~ (Not needed for internal VPC deployment)

**Post-Deploy:**

- [ ] All services healthy (`docker-compose ps`)
- [ ] HTTP accessible from VPC (`curl http://<private-ip>/health`)
- [ ] Logs clean (`docker-compose logs`)
- [ ] Cache working (`curl http://localhost/cache/stats`)
- [ ] Backup tested
- [ ] ~~SSL working~~ (Skip for internal deployment)

**Internal VPC Deployment:**

- [ ] EC2 in private subnet
- [ ] Security group allows port 80 from VPC CIDR only
- [ ] Other services can access via private IP
- [ ] No public IP assigned (optional, use bastion for SSH)
- [ ] SSL handled by ALB/API Gateway (if needed)

## AWS Deployment

### EC2 Instance (Internal VPC Deployment)

**Recommended for 16GB RAM:**

- Instance: t3.xlarge (4 vCPU, 16GB RAM)
- OS: Ubuntu 22.04 LTS
- Storage: 100GB+ GP3 SSD
- VPC: Private subnet (no public IP needed)
- Security Group: Allow port 80 from VPC CIDR only

**Security Group Rules:**

```
Inbound:
- Port 22 (SSH): Your IP only
- Port 80 (HTTP): VPC CIDR (e.g., 172.31.0.0/16) or specific service IPs

Outbound:
- All traffic (for Docker pulls and updates)
```

**Setup:**

```bash
# Connect to EC2 (via bastion or VPN)
ssh -i key.pem ubuntu@<private-ip>

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Clone & setup data
cd /opt
git clone <repo> osrm-service
cd osrm-service
chmod +x *.sh scripts/*.sh
./MASTER-SETUP.sh

# Deploy with production resources
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Verify
docker-compose ps
curl http://localhost/health
```

**Access from Other Services:**

```bash
# From Flutter/Mobile App (via API Gateway)
Mobile App → API Gateway → ALB/NLB → EC2 (Port 80)

# From Other Microservices (same VPC)
Service A → http://<ec2-private-ip>/route/...

# Example
curl "http://172.31.10.50/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753"
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
