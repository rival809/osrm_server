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

### Example Integration (Golang with Gin Framework)

#### 1. Service Layer (`services/osrm_service.go`)

```go
package services

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "time"
)

type OSRMService interface {
    GetRoute(startLon, startLat, endLon, endLat string, alternatives, steps bool) (map[string]interface{}, error)
    GetTile(z, x, y string) ([]byte, error)
    HealthCheck() (map[string]interface{}, error)
}

type osrmService struct {
    baseURL string
    client  *http.Client
}

func NewOSRMService() OSRMService {
    osrmURL := os.Getenv("OSRM_SERVICE_URL")
    if osrmURL == "" {
        osrmURL = "http://10.0.2.20" // Default internal IP
    }

    return &osrmService{
        baseURL: osrmURL,
        client: &http.Client{
            Timeout: 30 * time.Second,
        },
    }
}

func (s *osrmService) GetRoute(startLon, startLat, endLon, endLat string, alternatives, steps bool) (map[string]interface{}, error) {
    // Build OSRM URL
    url := fmt.Sprintf("%s/route?start=%s,%s&end=%s,%s&alternatives=%t&steps=%t",
        s.baseURL, startLon, startLat, endLon, endLat, alternatives, steps)

    // Make request
    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("routing service unavailable: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("routing request failed with status: %d", resp.StatusCode)
    }

    // Parse response
    var result map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, fmt.Errorf("failed to parse routing response: %v", err)
    }

    return result, nil
}

func (s *osrmService) GetTile(z, x, y string) ([]byte, error) {
    // Build tile URL
    url := fmt.Sprintf("%s/tiles/%s/%s/%s.png", s.baseURL, z, x, y)

    // Make request
    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("tile service unavailable: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("tile not found")
    }

    // Read tile data
    tileData, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("failed to read tile data: %v", err)
    }

    return tileData, nil
}

func (s *osrmService) HealthCheck() (map[string]interface{}, error) {
    url := fmt.Sprintf("%s/health", s.baseURL)

    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("health check failed: %v", err)
    }
    defer resp.Body.Close()

    var health map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
        return nil, fmt.Errorf("failed to parse health response: %v", err)
    }

    return health, nil
}
```

#### 2. Controller Layer (`controllers/osrm_controller.go`)

```go
package controllers

import (
    "net/http"
    "sambara-go-lang/helper"
    "sambara-go-lang/services"

    "github.com/gin-gonic/gin"
)

type OSRMController struct {
    service services.OSRMService
}

func NewOSRMController(s services.OSRMService) *OSRMController {
    return &OSRMController{s}
}

// GetRoute - Calculate route between two points
func (c *OSRMController) GetRoute(ctx *gin.Context) {
    allParams := helper.GetAllParamsOnly(ctx)
    requiredParams := map[string]string{
        "start_lon": "string",
        "start_lat": "string",
        "end_lon":   "string",
        "end_lat":   "string",
    }
    params, err := helper.GetAllParamsWithValidation(ctx, requiredParams)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusBadRequest, err.Error(), allParams)
        return
    }

    startLon := params["start_lon"]
    startLat := params["start_lat"]
    endLon := params["end_lon"]
    endLat := params["end_lat"]

    // Optional parameters
    alternatives := ctx.DefaultQuery("alternatives", "false") == "true"
    steps := ctx.DefaultQuery("steps", "false") == "true"

    data, err := c.service.GetRoute(startLon, startLat, endLon, endLat, alternatives, steps)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusInternalServerError, err.Error(), params)
        return
    }

    helper.SendSuccessResponse(ctx, data, params)
}

// GetTile - Get map tile image
func (c *OSRMController) GetTile(ctx *gin.Context) {
    z := ctx.Param("z")
    x := ctx.Param("x")
    y := ctx.Param("y")

    if z == "" || x == "" || y == "" {
        helper.SendErrorResponse(ctx, http.StatusBadRequest, "Invalid tile coordinates", nil)
        return
    }

    tileData, err := c.service.GetTile(z, x, y)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusNotFound, err.Error(), nil)
        return
    }

    // Return tile image
    ctx.Header("Content-Type", "image/png")
    ctx.Header("Cache-Control", "public, max-age=86400")
    ctx.Data(http.StatusOK, "image/png", tileData)
}

// HealthCheck - Check OSRM service health
func (c *OSRMController) HealthCheck(ctx *gin.Context) {
    data, err := c.service.HealthCheck()
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusServiceUnavailable, err.Error(), nil)
        return
    }
    helper.SendSuccessResponse(ctx, data, nil)
}
```

#### 3. Router Setup (`routes/osrm_routes.go`)

```go
package routes

import (
    "sambara-go-lang/controllers"
    "sambara-go-lang/services"

    "github.com/gin-gonic/gin"
)

func SetupOSRMRoutes(router *gin.RouterGroup) {
    // Initialize service and controller
    osrmService := services.NewOSRMService()
    osrmController := controllers.NewOSRMController(osrmService)

    // OSRM routes
    osrm := router.Group("/osrm")
    {
        osrm.GET("/route", osrmController.GetRoute)
        osrm.GET("/tiles/:z/:x/:y", osrmController.GetTile)
        osrm.GET("/health", osrmController.HealthCheck)
    }
}
```

#### 4. Main Setup (`main.go`)

```go
package main

import (
    "sambara-go-lang/routes"

    "github.com/gin-gonic/gin"
)

func main() {
    r := gin.Default()

    // API v1 group
    api := r.Group("/api/v1")
    {
        // ... other routes ...
        routes.SetupOSRMRoutes(api)
    }

    r.Run(":8080")
}
```

#### 5. Environment Configuration (`.env`)

```bash
# OSRM Service Configuration
OSRM_SERVICE_URL=http://10.0.2.20  # Internal IP OSRM service
```

#### 6. Usage Examples

**Request routing:**

```bash
GET /api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175
```

**Response:**

```json
{
  "status": "success",
  "message": "Success",
  "data": {
    "routes": [{
      "distance": 123456.78,
      "duration": 7890.12,
      "geometry": {...}
    }]
  },
  "params": {
    "start_lon": "106.8456",
    "start_lat": "-6.2088",
    "end_lon": "107.6191",
    "end_lat": "-6.9175"
  }
}
```

**Request tile:**

```bash
GET /api/v1/osrm/tiles/10/511/511
```

**Health check:**

```bash
GET /api/v1/osrm/health
```

#### 7. Optional: Background Health Check Worker

```go
// workers/osrm_health_worker.go
package workers

import (
    "log"
    "sambara-go-lang/services"
    "time"
)

func StartOSRMHealthCheck(service services.OSRMService) {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()

    log.Println("OSRM Health Check Worker started")

    for range ticker.C {
        health, err := service.HealthCheck()
        if err != nil {
            log.Printf("⚠️  OSRM Health Check FAILED: %v", err)
            // TODO: Send alert notification
            continue
        }

        if status, ok := health["status"].(string); ok {
            log.Printf("✅ OSRM Status: %s", status)
        }
    }
}

// In main.go, start worker:
// go workers.StartOSRMHealthCheck(osrmService)
```

---

## 📖 API Specification

### Base URL

```
Production: http://<osrm-internal-ip>
Development: http://localhost:81
```

### 1. Calculate Route

**Endpoint:** `GET /route`

**Description:** Calculate optimal route between two or more coordinates.

**Query Parameters:**

| Parameter      | Type    | Required | Description                                                 | Example            |
| -------------- | ------- | -------- | ----------------------------------------------------------- | ------------------ |
| `start`        | string  | ✅ Yes   | Start coordinates (lon,lat)                                 | `106.8456,-6.2088` |
| `end`          | string  | ✅ Yes   | End coordinates (lon,lat)                                   | `107.6191,-6.9175` |
| `alternatives` | boolean | ❌ No    | Return alternative routes (default: false)                  | `true`             |
| `steps`        | boolean | ❌ No    | Include turn-by-turn steps (default: false)                 | `true`             |
| `geometries`   | string  | ❌ No    | Geometry format: `geojson` or `polyline` (default: geojson) | `geojson`          |

**Request Example:**

```bash
GET /route?start=106.8456,-6.2088&end=107.6191,-6.9175&alternatives=true&steps=true
```

**Success Response (200):**

```json
{
  "code": "Ok",
  "routes": [
    {
      "distance": 123456.78,
      "duration": 7890.12,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [106.8456, -6.2088],
          [106.8467, -6.2095],
          [107.6191, -6.9175]
        ]
      },
      "legs": [
        {
          "distance": 123456.78,
          "duration": 7890.12,
          "steps": [
            {
              "distance": 234.5,
              "duration": 45.2,
              "geometry": {...},
              "name": "Jalan Sudirman",
              "mode": "driving",
              "maneuver": {
                "type": "depart",
                "location": [106.8456, -6.2088]
              }
            }
          ]
        }
      ]
    }
  ],
  "waypoints": [
    {
      "location": [106.8456, -6.2088],
      "name": "Jalan Sudirman"
    },
    {
      "location": [107.6191, -6.9175],
      "name": "Jalan Asia Afrika"
    }
  ]
}
```

**Error Response (400):**

```json
{
  "code": "InvalidQuery",
  "message": "Query string malformed: missing required parameter 'start'"
}
```

**Error Response (404):**

```json
{
  "code": "NoRoute",
  "message": "No route found between coordinates"
}
```

---

### 2. Get Map Tile

**Endpoint:** `GET /tiles/{z}/{x}/{y}.png`

**Description:** Get rendered map tile image for displaying maps.

**Path Parameters:**

| Parameter | Type    | Required | Description       | Range        |
| --------- | ------- | -------- | ----------------- | ------------ |
| `z`       | integer | ✅ Yes   | Zoom level        | 0-18         |
| `x`       | integer | ✅ Yes   | Tile X coordinate | 0 to 2^z - 1 |
| `y`       | integer | ✅ Yes   | Tile Y coordinate | 0 to 2^z - 1 |

**Request Example:**

```bash
GET /tiles/10/511/511.png
```

**Success Response (200):**

- Content-Type: `image/png`
- Cache-Control: `public, max-age=86400`
- Body: PNG image binary data

**Error Response (404):**

```json
{
  "code": "NotFound",
  "message": "Tile not found or out of bounds"
}
```

**Tile Coordinate Calculation:**

```javascript
// Convert lat/lon to tile coordinates
function latLonToTile(lat, lon, zoom) {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom)
  );
  return { x, y, z: zoom };
}
```

---

### 3. Health Check

**Endpoint:** `GET /health`

**Description:** Check service health and availability.

**Request Example:**

```bash
GET /health
```

**Success Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2025-12-10T10:30:00Z",
  "uptime": 86400,
  "services": {
    "osrm_backend": "running",
    "cache": "active",
    "memory": {
      "used": "2.5GB",
      "total": "8GB",
      "percentage": 31.25
    }
  },
  "version": "1.0.0"
}
```

**Error Response (503):**

```json
{
  "status": "unhealthy",
  "message": "OSRM backend not responding"
}
```

---

### 4. Cache Statistics (Read-Only)

**Endpoint:** `GET /cache/stats`

**Description:** Get cache statistics and performance metrics.

**Request Example:**

```bash
GET /cache/stats
```

**Success Response (200):**

```json
{
  "cache_mode": "smart",
  "total_cached_tiles": 15234,
  "cache_size_mb": 245.67,
  "max_cache_size_mb": 2000,
  "cache_usage_percent": 12.28,
  "hit_rate": 87.5,
  "stats": {
    "hits": 12500,
    "misses": 1780,
    "total_requests": 14280
  },
  "preloaded_tiles": 0,
  "disk_cache": {
    "enabled": true,
    "path": "/app/cache/tiles",
    "files": 15234
  }
}
```

---

### 5. Backend Sambara API Integration Spec

#### 5.1 Route API (Public Endpoint)

**Endpoint:** `GET /api/v1/osrm/route`

**Query Parameters:**

| Parameter      | Type   | Required | Description                          | Example    |
| -------------- | ------ | -------- | ------------------------------------ | ---------- |
| `start_lon`    | string | ✅ Yes   | Start longitude                      | `106.8456` |
| `start_lat`    | string | ✅ Yes   | Start latitude                       | `-6.2088`  |
| `end_lon`      | string | ✅ Yes   | End longitude                        | `107.6191` |
| `end_lat`      | string | ✅ Yes   | End latitude                         | `-6.9175`  |
| `alternatives` | string | ❌ No    | Return alternatives (`true`/`false`) | `true`     |
| `steps`        | string | ❌ No    | Include steps (`true`/`false`)       | `true`     |

**Request Example:**

```bash
GET /api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175
```

**Success Response (200):**

```json
{
  "status": "success",
  "message": "Success",
  "data": {
    "code": "Ok",
    "routes": [
      {
        "distance": 123456.78,
        "duration": 7890.12,
        "geometry": {
          "type": "LineString",
          "coordinates": [[106.8456, -6.2088], [107.6191, -6.9175]]
        }
      }
    ],
    "waypoints": [...]
  },
  "params": {
    "start_lon": "106.8456",
    "start_lat": "-6.2088",
    "end_lon": "107.6191",
    "end_lat": "-6.9175"
  }
}
```

**Error Response (400):**

```json
{
  "status": "error",
  "message": "Missing required parameters: start_lon",
  "data": null,
  "params": {}
}
```

**Error Response (500):**

```json
{
  "status": "error",
  "message": "routing service unavailable: connection refused",
  "data": null,
  "params": {
    "start_lon": "106.8456",
    "start_lat": "-6.2088",
    "end_lon": "107.6191",
    "end_lat": "-6.9175"
  }
}
```

#### 5.2 Tile API (Public Endpoint)

**Endpoint:** `GET /api/v1/osrm/tiles/:z/:x/:y`

**Path Parameters:**

- `z`: Zoom level (0-18)
- `x`: Tile X coordinate
- `y`: Tile Y coordinate

**Request Example:**

```bash
GET /api/v1/osrm/tiles/10/511/511
```

**Success Response (200):**

- Content-Type: `image/png`
- Body: PNG image binary

**Error Response (404):**

```json
{
  "status": "error",
  "message": "tile not found",
  "data": null
}
```

#### 5.3 Health Check (Internal Only)

**Endpoint:** `GET /api/v1/osrm/health`

**Success Response (200):**

```json
{
  "status": "success",
  "message": "Success",
  "data": {
    "status": "healthy",
    "timestamp": "2025-12-10T10:30:00Z",
    "uptime": 86400,
    "services": {
      "osrm_backend": "running",
      "cache": "active"
    }
  },
  "params": null
}
```

---

### Rate Limits

| Endpoint   | Limit     | Window        |
| ---------- | --------- | ------------- |
| `/route`   | 10 req/s  | Per IP        |
| `/tiles/*` | 100 req/s | Per IP        |
| `/health`  | 20 req/s  | Per IP        |
| All APIs   | 20 req/s  | Global per IP |

**Rate Limit Headers:**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1638259200
```

**Rate Limit Exceeded Response (429):**

```json
{
  "code": "TooManyRequests",
  "message": "Rate limit exceeded. Try again in 60 seconds."
}
```

---

### Error Codes

| Code                 | HTTP Status | Description              |
| -------------------- | ----------- | ------------------------ |
| `Ok`                 | 200         | Success                  |
| `InvalidQuery`       | 400         | Invalid query parameters |
| `NoRoute`            | 404         | No route found           |
| `NotFound`           | 404         | Resource not found       |
| `TooManyRequests`    | 429         | Rate limit exceeded      |
| `InternalError`      | 500         | Internal server error    |
| `ServiceUnavailable` | 503         | OSRM backend unavailable |

---

### Data Types

#### Distance

- **Unit:** Meters (m)
- **Type:** Float
- **Example:** `123456.78` (123.45 km)

#### Duration

- **Unit:** Seconds (s)
- **Type:** Float
- **Example:** `7890.12` (2 hours 11 minutes)

#### Coordinates

- **Format:** `[longitude, latitude]`
- **Type:** Array of Float
- **Range:** lon: -180 to 180, lat: -90 to 90
- **Example:** `[106.8456, -6.2088]`

#### Geometry Format

- **geojson:** GeoJSON LineString format (default)
- **polyline:** Google Polyline encoding (precision 5)

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
