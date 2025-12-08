# Setup Guide

Complete setup guide untuk OSRM Tile Service - Java Island.

## Prerequisites

### Windows

- Windows 10/11 (64-bit)
- Docker Desktop
- Node.js 18+ LTS
- 8GB+ RAM, 50GB+ disk
- **Note:** Docker Desktop handles memory management automatically

### Linux/Ubuntu

- Ubuntu 20.04/22.04
- Docker & Docker Compose
- Node.js 18+ LTS
- 8GB+ RAM, 50GB+ disk
- **Recommended:** 4GB+ swap memory for stability

## Quick Setup

### Windows

```powershell
# 1. Clone repository
git clone <repo-url>
cd osrm_server

# 2. Run automated setup
.\MASTER-SETUP.ps1

# What it does:
# - Checks/installs Node.js & Docker
# - Downloads OSM data (~800MB)
# - Processes OSRM files (10-20 min)
# - Installs npm dependencies
# - Creates .env file

# 3. Start services
.\START.ps1

# 4. Verify
# Open: http://localhost:80
```

### Linux

```bash
# 1. Clone repository
git clone <repo-url>
cd osrm_server
chmod +x *.sh scripts/*.sh

# 2. Run automated setup
./MASTER-SETUP.sh

# What it does:
# - Checks/installs Node.js & Docker
# - Downloads OSM data (~800MB)
# - Processes OSRM files (10-20 min)
# - Installs npm dependencies
# - Creates .env file

# 3. Start services
./START.sh

# 4. Verify
# Open: http://localhost:80
```

## Manual Setup (Optional)

If automated setup fails, follow these steps:

### 1. Install Prerequisites

**Windows:**

```powershell
# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Node.js & Docker
choco install nodejs-lts docker-desktop -y

# Restart computer
```

**Linux:**

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Install Docker
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine and plugins
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

# Enable and start Docker
sudo systemctl enable docker
sudo systemctl start docker

# Verify Docker is running
docker --version
sudo docker ps

# Note: You may need to logout/login for docker group to take effect
# Until then, use 'sudo docker' commands
```

### 2. Download OSM Data

```bash
# Windows
.\scripts\download-pbf.ps1

# Linux
./scripts/download-pbf.sh

# Manual download if needed:
# https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
# Save to: data/java-latest.osm.pbf
```

### 3. Process OSRM Data

```bash
# Windows
.\scripts\process-osrm-v6.ps1

# Linux
./scripts/process-osrm-v6.sh

# This takes 10-20 minutes
# Output: data/java-latest.osrm.* files
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Start Services

```bash
# Windows
.\START.ps1

# Linux
./START.sh
```

## Configuration

The `.env` file is created automatically. Default values:

```bash
NODE_ENV=production
PORT=8080
OSRM_URL=http://osrm-backend:5000
CACHE_DIR=/app/cache
CACHE_MODE=smart
MAX_CACHE_SIZE_MB=1000
TILE_CACHE_TTL=180
```

## Troubleshooting

### Docker Not Running

```bash
# Windows: Start Docker Desktop application
# Linux: sudo systemctl start docker
```

### Uninstall Docker (Linux)

If you need to completely remove Docker and start fresh:

```bash
# 1. Stop all containers
docker stop $(docker ps -aq) 2>/dev/null

# 2. Remove all containers
docker rm $(docker ps -aq) 2>/dev/null

# 3. Remove all images
docker rmi $(docker images -q) 2>/dev/null

# 4. Stop Docker service
sudo systemctl stop docker
sudo systemctl stop docker.socket

# 5. Uninstall Docker packages
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo apt-get autoremove -y

# 6. Remove Docker data and configuration
sudo rm -rf /var/lib/docker
sudo rm -rf /var/lib/containerd
sudo rm -rf /etc/docker
sudo rm -rf ~/.docker

# 7. Remove Docker group
sudo groupdel docker 2>/dev/null

# 8. Clean up APT sources
sudo rm -f /etc/apt/sources.list.d/docker.list
sudo rm -f /etc/apt/keyrings/docker.asc

# 9. Verify removal
docker --version 2>/dev/null && echo "Docker still installed" || echo "Docker completely removed"

# 10. Now you can reinstall Docker using the steps in section 1
```

### Download Fails

```bash
# Try alternative download script
# Windows: .\scripts\download-pbf-improved.ps1
# Linux: ./scripts/download-pbf.sh

# Or download manually from:
# https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
```

### OSRM Processing Fails

```bash
# Check Docker is running
docker ps

# Check data file exists and is > 700MB
ls -lh data/java-latest.osm.pbf

# Re-download if corrupted
rm data/java-latest.osm.pbf
# Run download script again
```

### Out of Memory

```bash
# Increase Docker memory limit:
# Docker Desktop → Settings → Resources → Memory
# Set to at least 6GB

# Or process on Linux server with more RAM
```

### Add Swap Space (Linux - 4GB)

If processing fails due to memory, add swap space:

```bash
# 1. Check current swap
free -h

# 2. Create swap file (4GB)
sudo fallocate -l 4G /swapfile

# 3. Set permissions
sudo chmod 600 /swapfile

# 4. Setup swap
sudo mkswap /swapfile

# 5. Enable swap
sudo swapon /swapfile

# 6. Verify
free -h
# Should show 4G swap

# 7. Make permanent (add to /etc/fstab)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 8. Optimize swappiness (optional)
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

To resize existing swap (e.g., from 4GB to 8GB):

```bash
# 1. Disable current swap
sudo swapoff /swapfile

# 2. Remove old swap file
sudo rm /swapfile

# 3. Create new swap file (8GB)
sudo fallocate -l 8G /swapfile

# 4. Set permissions
sudo chmod 600 /swapfile

# 5. Setup new swap
sudo mkswap /swapfile

# 6. Enable swap
sudo swapon /swapfile

# 7. Verify new size
free -h
# Should show 8G swap

# Note: /etc/fstab already has the entry, no need to add again
```

To remove swap later:

```bash
sudo swapoff /swapfile
sudo rm /swapfile
# Remove line from /etc/fstab
```

### Port Already in Use

```bash
# Windows
netstat -ano | findstr :80
# Kill process using the port

# Linux
sudo lsof -i :80
sudo kill <PID>
```

## Next Steps

After successful setup:

1. **Access Services**

   - Web UI: http://localhost:80/
   - Health: http://localhost:80/health
   - API Docs: http://localhost:80/

2. **Preload Cache** (Optional)

   ```bash
   # Windows: .\CACHE-MANAGER.ps1
   # Linux: ./CACHE-MANAGER.sh
   # Select option 2 for preload
   ```

3. **Production Deployment**
   - See [PRODUCTION.md](PRODUCTION.md) for deployment guide

## Management Commands

```bash
# Start services
.\START.ps1 / ./START.sh

# Stop services
.\STOP.ps1 / ./STOP.sh

# Check status
.\docker.ps1 status / ./docker.sh status

# View logs
.\docker.ps1 logs / ./docker.sh logs

# Health check
.\docker.ps1 health / ./docker.sh health

# Cache management
.\CACHE-MANAGER.ps1 / ./CACHE-MANAGER.sh
```

## Support

For issues:

1. Check logs: `docker-compose logs`
2. Check GitHub issues
3. Review troubleshooting section above
