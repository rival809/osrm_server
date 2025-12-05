# OSRM Service - Deployment Guide

**Version:** 1.0  
**Target:** Internal Microservice (Backend Sambara Integration)  
**Region:** Java Island

---

## 📋 Overview

OSRM Service adalah internal routing microservice yang menyediakan:

- Routing API (calculate routes between coordinates)
- Map Tiles API (render map tiles)
- Offline capability (pre-cached tiles)

**Architecture Pattern:**

```
User → Backend Sambara (Gateway) → OSRM Service (Internal)
```

---

## 🔧 Server Requirements

### Minimum Specs (Development):

- **CPU:** 2 vCPU
- **RAM:** 8GB
- **Storage:** 50GB SSD
- **OS:** Ubuntu 20.04/22.04 LTS
- **Network:** Private subnet (no public internet required)

### Recommended Specs (Production):

- **CPU:** 4+ vCPU
- **RAM:** 16GB
- **Storage:** 100GB SSD
- **Swap:** 4GB
- **Network:** Private VPC with Backend Sambara access

---

## 🚀 Quick Deployment Steps

### 1. Server Setup

```bash
# SSH to server
ssh ubuntu@<server-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker
docker --version
docker-compose --version
```

### 2. Clone Repository

```bash
# Clone to /opt directory
cd /opt
sudo git clone <REPO_URL> osrm-service
sudo chown -R $USER:$USER osrm-service
cd osrm-service
```

### 3. Configure Swap (Recommended)

```bash
# Create 4GB/8GB swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

### 4. Process OSRM Data

```bash
# Make scripts executable
chmod +x *.sh scripts/*.sh

# Run master setup (downloads OSM data + processes OSRM files)
./MASTER-SETUP.sh

# This will take 10-20 minutes
# Downloads: ~800MB OSM data
# Processing: Creates OSRM routing files
```

### 5. Deploy Services

**For 8GB RAM servers:**

```bash
docker-compose build --no-cache
docker-compose up -d
```

**For 8GB+ RAM servers (Production):**

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 6. Configure Firewall

**IMPORTANT: Only allow access from Backend Sambara!**

```bash
# Get Backend Sambara IP first
BACKEND_SAMBARA_IP="<IP_ADDRESS>"

# Configure UFW
sudo ufw allow from $BACKEND_SAMBARA_IP to any port 80 proto tcp
sudo ufw allow from <ADMIN_IP> to any port 22 proto tcp
sudo ufw default deny incoming
sudo ufw enable

# Verify
sudo ufw status
```

**AWS Security Group:**

```yaml
Inbound:
  - Port 80, Source: <Backend-Sambara-SG-ID>, Description: "HTTP from gateway"
  - Port 22, Source: <Admin-IP>/32, Description: "SSH admin"
```

### 7. Verify Deployment

```bash
# Check containers
docker-compose ps

# All should be "Up" and healthy
# - osrm-nginx
# - osrm-backend
# - osrm-api-1
# - osrm-api-2

# Test health endpoint
curl http://localhost/health

# Expected: {"status":"ok", ...}

# Test routing
curl "http://localhost/route?start=106.8456,-6.2088&end=106.8894,-6.1753"

# Expected: {"success":true, "data":{...}}
```

---

## 🔌 API Endpoints

### Base URL

```
http://<INTERNAL_IP>:80
```

### Available Endpoints

#### 1. Health Check

```bash
GET /health
```

Returns: Service status, memory usage, cache stats

#### 2. Routing API

```bash
GET /route?start=LON,LAT&end=LON,LAT
```

Parameters:

- `start`: Start coordinates (longitude,latitude)
- `end`: End coordinates (longitude,latitude)
- `alternatives`: true/false (optional)
- `steps`: true/false (optional)
- `geometries`: geojson/polyline (optional)

#### 3. Tiles API

```bash
GET /tiles/{z}/{x}/{y}.png
```

Returns: Map tile image (PNG)

#### 4. Cache Stats

```bash
GET /cache/stats
```

Returns: Cache statistics (read-only)

**Note:** All write/preload endpoints are disabled for security.

---

### Rate Limiting (Nginx)

Built-in rate limits:

- API requests: 20 req/s per IP
- Route requests: 10 req/s per IP
- Tile requests: 100 req/s per IP

## 🛠️ Maintenance

### Service Management

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f nginx
docker-compose logs -f osrm-api-1
```

### Cache Management

**Preload tiles (before going offline):**

```bash
# Linux
./CACHE-MANAGER.sh

# Choose option 3: Preload Java Island tiles
# This will download tiles for zoom levels 10-13
```

**View cache statistics:**

```bash
curl http://localhost/cache/stats
```

### Updates

```bash
# Pull latest code
cd /opt/osrm-service
git pull

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d
```

### Monitoring

```bash
# Check container resources
docker stats

# Check disk usage
df -h
du -sh cache/

# Check memory
free -h

# Check logs
tail -f logs/*.log
```

---

## 🔗 Backend Sambara Integration

### Example Integration (Golang)

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "time"
)

var OSRM_URL = getEnv("OSRM_SERVICE_URL", "http://10.0.2.20")

func getEnv(key, fallback string) string {
    if value, ok := os.LookupEnv(key); ok {
        return value
    }
    return fallback
}

// Route API Handler
func routeHandler(w http.ResponseWriter, r *http.Request) {
    // Get query parameters
    startLat := r.URL.Query().Get("startLat")
    startLon := r.URL.Query().Get("startLon")
    endLat := r.URL.Query().Get("endLat")
    endLon := r.URL.Query().Get("endLon")

    // Validate parameters
    if startLat == "" || startLon == "" || endLat == "" || endLon == "" {
        http.Error(w, "Missing required parameters", http.StatusBadRequest)
        return
    }

    // Build OSRM URL
    url := fmt.Sprintf("%s/route?start=%s,%s&end=%s,%s",
        OSRM_URL, startLon, startLat, endLon, endLat)

    // Create HTTP client with timeout
    client := &http.Client{
        Timeout: 30 * time.Second,
    }

    // Make request to OSRM service
    resp, err := client.Get(url)
    if err != nil {
        http.Error(w, "Routing service unavailable", http.StatusServiceUnavailable)
        return
    }
    defer resp.Body.Close()

    // Read response body
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        http.Error(w, "Failed to read response", http.StatusInternalServerError)
        return
    }

    // Forward response to client
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(resp.StatusCode)
    w.Write(body)
}

// Tiles Proxy Handler
func tilesHandler(w http.ResponseWriter, r *http.Request) {
    // Extract z, x, y from URL path
    // Example: /api/tiles/10/511/511.png
    var z, x, y string
    fmt.Sscanf(r.URL.Path, "/api/tiles/%s/%s/%s.png", &z, &x, &y)

    if z == "" || x == "" || y == "" {
        http.Error(w, "Invalid tile coordinates", http.StatusBadRequest)
        return
    }

    // Build OSRM tile URL
    url := fmt.Sprintf("%s/tiles/%s/%s/%s.png", OSRM_URL, z, x, y)

    // Create HTTP client with timeout
    client := &http.Client{
        Timeout: 10 * time.Second,
    }

    // Make request to OSRM service
    resp, err := client.Get(url)
    if err != nil {
        http.Error(w, "Tile not found", http.StatusNotFound)
        return
    }
    defer resp.Body.Close()

    // Check if tile was found
    if resp.StatusCode != http.StatusOK {
        http.Error(w, "Tile not found", http.StatusNotFound)
        return
    }

    // Read tile data
    tileData, err := io.ReadAll(resp.Body)
    if err != nil {
        http.Error(w, "Failed to read tile", http.StatusInternalServerError)
        return
    }

    // Return tile image
    w.Header().Set("Content-Type", "image/png")
    w.Header().Set("Cache-Control", "public, max-age=86400")
    w.WriteHeader(http.StatusOK)
    w.Write(tileData)
}

func main() {
    // Register handlers
    http.HandleFunc("/api/route", routeHandler)
    http.HandleFunc("/api/tiles/", tilesHandler)

    // Start server
    fmt.Println("Backend Sambara listening on :8080")
    http.ListenAndServe(":8080", nil)
}
```

### Health Check from Backend Sambara

```go
// Periodic health check
func healthCheckWorker() {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()

    client := &http.Client{
        Timeout: 5 * time.Second,
    }

    for range ticker.C {
        resp, err := client.Get(fmt.Sprintf("%s/health", OSRM_URL))
        if err != nil {
            log.Printf("OSRM DOWN: %v", err)
            // Alert or switch to backup
            continue
        }
        defer resp.Body.Close()

        var health map[string]interface{}
        if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
            log.Printf("Failed to parse health response: %v", err)
            continue
        }

        if status, ok := health["status"].(string); ok {
            log.Printf("OSRM Status: %s", status)
        }
    }
}

// Start health check in main()
func main() {
    // Register handlers
    http.HandleFunc("/api/route", routeHandler)
    http.HandleFunc("/api/tiles/", tilesHandler)

    // Start health check worker
    go healthCheckWorker()

    // Start server
    fmt.Println("Backend Sambara listening on :8080")
    http.ListenAndServe(":8080", nil)
}
```

---

## 📊 Resource Usage

### Development Mode (docker-compose.yml)

- **Backend:** 4GB RAM, 2 CPU
- **API-1:** 2GB RAM, 1 CPU
- **API-2:** 2GB RAM, 1 CPU
- **Nginx:** 512MB RAM, 0.25 CPU
- **Total:** ~8.5GB RAM, 2.25 CPU

### Production Mode (docker-compose.prod.yml)

- **Backend:** 4GB RAM, 1 CPU
- **API-1:** 2GB RAM, 0.5 CPU
- **API-2:** 2GB RAM, 0.5 CPU
- **Nginx:** 512MB RAM, 0.25 CPU
- **Total:** ~8.5GB RAM, 2.25 CPU

**Note:** Prod mode optimized for 2+ vCPU servers with better resource distribution.

---

## 🐛 Troubleshooting

### Service won't start

```bash
# Check logs
docker-compose logs

# Check if ports are in use
sudo netstat -tulpn | grep :80

# Check disk space
df -h

# Check memory
free -h
```

### Routing returns errors

```bash
# Check OSRM backend status
docker-compose logs osrm-backend

# Verify data files exist
ls -lh data/*.osrm*

# Should see 26 files including java-latest.osrm.ebg
```

### High memory usage

```bash
# Check container stats
docker stats

# Restart services
docker-compose restart

# Clear cache if needed (via script)
./CACHE-MANAGER.sh
# Option 4: Clean cache
```

### Cannot access from Backend Sambara

```bash
# Verify firewall rules
sudo ufw status

# Test from local server (should work)
curl http://localhost/health

# Test from Backend Sambara
curl http://<OSRM_INTERNAL_IP>/health

# Check AWS Security Group if on AWS
```

---

## 📞 Support

### Logs Location

- **Application:** `logs/*.log`
- **Docker:** `docker-compose logs`
- **Nginx:** `docker exec osrm-nginx tail -f /var/log/nginx/access.log`

### Important Files

- **Config:** `.env`, `docker-compose.yml`, `nginx/nginx.conf`
- **Data:** `data/*.osrm*` (26 files)
- **Cache:** `cache/tiles/` (auto-generated)
- **Scripts:** `MASTER-SETUP.sh`, `CACHE-MANAGER.sh`

### Common Commands

```bash
# Full restart
docker-compose down && docker-compose up -d

# Check service health
curl http://localhost/health | jq

# Monitor real-time logs
docker-compose logs -f --tail=100

# Check cache size
du -sh cache/

# Resource monitoring
docker stats --no-stream
```
