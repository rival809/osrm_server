# Setup Guide

Complete setup guide untuk OSRM Tile Service - Java Island.

## Prerequisites

### Windows

- Windows 10/11 (64-bit)
- Docker Desktop
- Node.js 18+ LTS
- 8GB+ RAM, 50GB+ disk

### Linux/Ubuntu

- Ubuntu 20.04/22.04
- Docker & Docker Compose
- Node.js 18+ LTS
- 8GB+ RAM, 50GB+ disk

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
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose -y

# Logout and login
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
TILE_CACHE_TTL=604800000
```

## Troubleshooting

### Docker Not Running

```bash
# Windows: Start Docker Desktop application
# Linux: sudo systemctl start docker
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
