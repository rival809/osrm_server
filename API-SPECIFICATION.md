# OSRM Service - API Specification

**Version:** 2.0  
**Last Updated:** January 28, 2026  
**Architecture:** Lightweight Proxy (Self-Hosted)
**Base URL:** `http://<osrm-internal-ip>:81` (Development: `http://localhost:81`)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
  - [Health Check](#1-health-check)
  - [Route Calculation](#2-route-calculation)
  - [Map Tiles](#3-map-tiles)
- [Backend Sambara Integration](#backend-sambara-integration)
- [Rate Limiting](#rate-limiting)
- [Error Codes](#error-codes)

---

## Overview

OSRM Service adalah **internal microservice** dengan lightweight proxy architecture.

**Features:**

- 🗺️ 100% Self-hosted (no external tile servers)
- 🚀 Lightweight proxy (no file caching)
- 🐋 3-container architecture
- 📍 Java Island coverage

### Architecture

```
Client Request
    ↓
[osrm-tile-service] Port 81 - Lightweight Proxy
    ├─→ /route → [osrm-backend] Port 5000 (Routing)
    └─→ /tiles → [tileserver] Port 8000 (Tiles from MBTiles)

Backend Sambara (Gateway) :8080
    ↓ HTTP (Private Network)
OSRM Service :81 (Internal - No rate limit)
    ↓
OSRM Backend :5000 + Tileserver :8000
```

---

## Authentication

**Internal Service:** No authentication required (private network only)  
**Backend Sambara:** Handles authentication at gateway level

**Security:**

- OSRM service should only be accessible from Backend Sambara IP
- Firewall rules restrict external access
- **Rate limiting handled at Backend Sambara Gateway** (not in OSRM service)

---

## API Endpoints

### 1. Health Check

Monitor service status and connectivity to backend services.

**Endpoint:** `GET /health`

**Request Example:**

```bash
curl "http://localhost:81/health"
```

**Success Response (200):**

```json
{
  "status": "ok",
  "service": "OSRM Tile Service (Self-Hosted Proxy)",
  "region": "Java Island",
  "architecture": "lightweight-proxy",
  "tileServer": "http://tileserver:8080/styles/basic-preview",
  "tileserverStatus": "ok",
  "osrmBackend": "http://osrm-backend:5000",
  "memory": {
    "current": {
      "rss": 74,
      "heapUsed": 18,
      "heapTotal": 23,
      "external": 3
    },
    "percent": 3.7,
    "status": "ok"
  },
  "timestamp": "2026-01-28T05:12:00Z"
}
```

---

### 2. Route Calculation

Calculate optimal route between two points.

**Endpoint:** `GET /route`

**Query Parameters:**

| Parameter      | Type   | Required | Description         | Example                 |
| -------------- | ------ | -------- | ------------------- | ----------------------- |
| `start`        | string | ✅ Yes   | Start lon,lat       | `107.6191,-6.9175`      |
| `end`          | string | ✅ Yes   | End lon,lat         | `107.5419,-6.8722`      |
| `alternatives` | string | ❌ No    | Return alternatives | `true` (default: false) |
| `steps`        | string | ❌ No    | Include steps       | `true` (default: true)  |
| `geometries`   | string | ❌ No    | Geometry format     | `geojson` (default)     |

**Request Example:**

```bash
curl "http://localhost:81/route?start=107.6191,-6.9175&end=107.5419,-6.8722"
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "routes": [{
      "distance": 12345.67,
      "duration": 1234.56,
      "geometry": { "type": "LineString", "coordinates": [...] },
      "legs": [...]
    }],
    "waypoints": [...]
  },
  "processingTime": 45
}
```

---

### 3. Map Tiles

Proxy to tileserver for map tile images.

**Endpoint:** `GET /tiles/{z}/{x}/{y}.png`

**Path Parameters:**

| Parameter | Type    | Description       | Example |
| --------- | ------- | ----------------- | ------- |
| `z`       | integer | Zoom level (2-18) | `13`    |
| `x`       | integer | Tile X coordinate | `6544`  |
| `y`       | integer | Tile Y coordinate | `4253`  |

**Request Example:**

```bash
curl "http://localhost:81/tiles/13/6544/4253.png" -o tile.png
```

**Response:** PNG image (binary)

---

## Backend Sambara Integration

Calculate optimal route between two or more coordinates using OSRM routing engine.

**Endpoint:** `GET /route`

**Query Parameters:**

| Parameter      | Type    | Required | Default   | Description                              |
| -------------- | ------- | -------- | --------- | ---------------------------------------- |
| `start`        | string  | ✅ Yes   | -         | Start coordinates in format `lon,lat`    |
| `end`          | string  | ✅ Yes   | -         | End coordinates in format `lon,lat`      |
| `alternatives` | boolean | ❌ No    | `false`   | Return alternative routes                |
| `steps`        | boolean | ❌ No    | `false`   | Include turn-by-turn navigation steps    |
| `geometries`   | string  | ❌ No    | `geojson` | Geometry format: `geojson` or `polyline` |

**Request Example:**

```bash
GET /route?start=106.8456,-6.2088&end=107.6191,-6.9175&alternatives=true&steps=true
```

```bash
curl "http://192.168.99.130:81/route?start=106.8456,-6.2088&end=107.6191,-6.9175"
```

**Success Response (200):**

```json
{
  "code": "Ok",
  "routes": [
    {
      "distance": 123456.78,
      "duration": 7890.12,
      "weight": 7890.12,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [106.8456, -6.2088],
          [106.8467, -6.2095],
          [106.8512, -6.2134],
          [107.6191, -6.9175]
        ]
      },
      "legs": [
        {
          "distance": 123456.78,
          "duration": 7890.12,
          "weight": 7890.12,
          "summary": "Jalan Tol Jakarta - Bandung",
          "steps": [
            {
              "distance": 234.5,
              "duration": 45.2,
              "weight": 45.2,
              "name": "Jalan Sudirman",
              "mode": "driving",
              "maneuver": {
                "type": "depart",
                "location": [106.8456, -6.2088],
                "bearing_before": 0,
                "bearing_after": 90,
                "instruction": "Head east on Jalan Sudirman"
              },
              "geometry": {
                "type": "LineString",
                "coordinates": [
                  [106.8456, -6.2088],
                  [106.8467, -6.2095]
                ]
              }
            },
            {
              "distance": 456.8,
              "duration": 78.5,
              "weight": 78.5,
              "name": "Jalan Gatot Subroto",
              "mode": "driving",
              "maneuver": {
                "type": "turn",
                "location": [106.8467, -6.2095],
                "modifier": "right",
                "bearing_before": 90,
                "bearing_after": 180,
                "instruction": "Turn right onto Jalan Gatot Subroto"
              },
              "geometry": {
                "type": "LineString",
                "coordinates": [
                  [106.8467, -6.2095],
                  [106.8512, -6.2134]
                ]
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
      "name": "Jalan Sudirman",
      "hint": "..."
    },
    {
      "location": [107.6191, -6.9175],
      "name": "Jalan Asia Afrika",
      "hint": "..."
    }
  ]
}
```

**Error Response (400 - Invalid Query):**

```json
{
  "code": "InvalidQuery",
  "message": "Query string malformed: missing required parameter 'start'"
}
```

**Error Response (404 - No Route):**

```json
{
  "code": "NoRoute",
  "message": "No route found between coordinates"
}
```

---

### 2. Get Map Tile

Get rendered map tile image for displaying maps in applications.

**Endpoint:** `GET /tiles/{z}/{x}/{y}.png`

**Path Parameters:**

| Parameter | Type    | Required | Range        | Description       |
| --------- | ------- | -------- | ------------ | ----------------- |
| `z`       | integer | ✅ Yes   | 0-18         | Zoom level        |
| `x`       | integer | ✅ Yes   | 0 to 2^z - 1 | Tile X coordinate |
| `y`       | integer | ✅ Yes   | 0 to 2^z - 1 | Tile Y coordinate |

**Request Example:**

```bash
GET /tiles/10/511/511.png
```

```bash
curl "http://192.168.99.130:81/tiles/10/511/511.png" --output tile.png
```

**Success Response (200):**

- **Content-Type:** `image/png`
- **Cache-Control:** `public, max-age=86400` (24 hours)
- **Body:** PNG image binary data

**Error Response (404):**

```json
{
  "code": "NotFound",
  "message": "Tile not found or out of bounds"
}
```

**Tile Coordinate Calculation:**

```javascript
// JavaScript/TypeScript
function latLonToTile(lat, lon, zoom) {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom),
  );
  return { x, y, z: zoom };
}

// Example: Jakarta coordinates
const tile = latLonToTile(-6.2088, 106.8456, 10);
// Returns: { x: 511, y: 511, z: 10 }
```

```python
# Python
import math

def lat_lon_to_tile(lat, lon, zoom):
    x = int((lon + 180) / 360 * (2 ** zoom))
    y = int((1 - math.log(math.tan(lat * math.pi / 180) +
            1 / math.cos(lat * math.pi / 180)) / math.pi) / 2 * (2 ** zoom))
    return {'x': x, 'y': y, 'z': zoom}
```

---

### 3. Health Check

Check service health status and availability.

**Endpoint:** `GET /health`

**Request Example:**

```bash
GET /health
```

```bash
curl "http://192.168.99.130:81/health"
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
  "version": "1.0.0",
  "region": "Java Island"
}
```

**Error Response (503 - Service Unavailable):**

```json
{
  "status": "unhealthy",
  "message": "OSRM backend not responding",
  "timestamp": "2025-12-10T10:30:00Z"
}
```

---

### 4. Cache Statistics

Get cache performance metrics and statistics (read-only).

**Endpoint:** `GET /cache/stats`

**Request Example:**

```bash
GET /cache/stats
```

```bash
curl "http://192.168.99.130:81/cache/stats"
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
  },
  "memory_cache": {
    "enabled": true,
    "entries": 256,
    "size_mb": 45.2
  }
}
```

---

## Backend Sambara Integration API

All endpoints follow standardized Backend Sambara response format.

### 5.1 Route API (Public Endpoint)

**Endpoint:** `GET /api/v1/osrm/route`

**Query Parameters:**

| Parameter      | Type   | Required | Description                               | Example    |
| -------------- | ------ | -------- | ----------------------------------------- | ---------- |
| `start_lon`    | string | ✅ Yes   | Start longitude                           | `106.8456` |
| `start_lat`    | string | ✅ Yes   | Start latitude                            | `-6.2088`  |
| `end_lon`      | string | ✅ Yes   | End longitude                             | `107.6191` |
| `end_lat`      | string | ✅ Yes   | End latitude                              | `-6.9175`  |
| `alternatives` | string | ❌ No    | Return alternatives (`true`/`false`)      | `true`     |
| `steps`        | string | ❌ No    | Include navigation steps (`true`/`false`) | `true`     |

**Request Example:**

```bash
GET /api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175
```

```bash
curl "http://backend-sambara:8080/api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175"
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
          "coordinates": [
            [106.8456, -6.2088],
            [107.6191, -6.9175]
          ]
        },
        "legs": [...]
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
  },
  "params": {
    "start_lon": "106.8456",
    "start_lat": "-6.2088",
    "end_lon": "107.6191",
    "end_lat": "-6.9175"
  }
}
```

**Error Response (400 - Bad Request):**

```json
{
  "status": "error",
  "message": "Missing required parameters: start_lon",
  "data": null,
  "params": {}
}
```

**Error Response (500 - Internal Server Error):**

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

---

### 5.2 Tile API (Public Endpoint)

**Endpoint:** `GET /api/v1/osrm/tiles/:z/:x/:y`

**Path Parameters:**

| Parameter | Type   | Required | Description       |
| --------- | ------ | -------- | ----------------- |
| `z`       | string | ✅ Yes   | Zoom level (0-18) |
| `x`       | string | ✅ Yes   | Tile X coordinate |
| `y`       | string | ✅ Yes   | Tile Y coordinate |

**Request Example:**

```bash
GET /api/v1/osrm/tiles/10/511/511
```

```bash
curl "http://backend-sambara:8080/api/v1/osrm/tiles/10/511/511" --output tile.png
```

**Success Response (200):**

- **Content-Type:** `image/png`
- **Cache-Control:** `public, max-age=86400`
- **Body:** PNG image binary data

**Error Response (404):**

```json
{
  "status": "error",
  "message": "tile not found",
  "data": null
}
```

---

### 5.3 Health Check (Internal Only)

**Endpoint:** `GET /api/v1/osrm/health`

**Request Example:**

```bash
GET /api/v1/osrm/health
```

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

**Error Response (503):**

```json
{
  "status": "error",
  "message": "health check failed: OSRM service unavailable",
  "data": null,
  "params": null
}
```

---

## Rate Limiting

**⚠️ Important: Rate limiting is DISABLED in OSRM Service**

**Architecture Pattern:**

```
Users → Backend Sambara (Rate limit PER USER) → OSRM Service (No limit - trusted)
```

**Why Disabled:**

- OSRM service is **internal microservice** (not exposed to public)
- Backend Sambara already handles authentication + rate limiting per user
- All traffic from Backend Sambara appears as single IP
- Rate limiting at OSRM would incorrectly limit ALL users combined

**Recommendation for Backend Sambara:**

- Implement rate limiting per user ID or session token
- Suggested: 100-200 requests/minute per user
- Forward original client IP via `X-Forwarded-For` header
- Monitor usage and adjust thresholds as needed

**Example Rate Limiting at Gateway (Golang):**

```go
import "github.com/didip/tollbooth"

// Create limiter: 100 requests/minute per user
limiter := tollbooth.NewLimiter(100, nil)
limiter.SetIPLookups([]string{"X-Real-IP", "X-Forwarded-For"})

// Apply to routes
router.Use(tollbooth.LimitHandler(limiter))
```

---

## Error Codes

### HTTP Status Codes

| Status Code | Description                                  |
| ----------- | -------------------------------------------- |
| 200         | Success                                      |
| 400         | Bad Request - Invalid parameters             |
| 404         | Not Found - Route/tile not found             |
| 429         | Too Many Requests - Rate limit exceeded      |
| 500         | Internal Server Error                        |
| 503         | Service Unavailable - Backend not responding |

### OSRM Error Codes

| Code                 | HTTP Status | Description                                                |
| -------------------- | ----------- | ---------------------------------------------------------- |
| `Ok`                 | 200         | Success                                                    |
| `InvalidQuery`       | 400         | Invalid query parameters or malformed request              |
| `InvalidValue`       | 400         | Invalid parameter value                                    |
| `NoSegment`          | 400         | One of the coordinates cannot be snapped to street segment |
| `NoRoute`            | 404         | No route found between coordinates                         |
| `NotFound`           | 404         | Resource not found                                         |
| `TooManyRequests`    | 429         | Rate limit exceeded                                        |
| `InternalError`      | 500         | Internal server error                                      |
| `ServiceUnavailable` | 503         | OSRM backend unavailable                                   |

---

## Data Types

### Distance

- **Unit:** Meters (m)
- **Type:** Float
- **Example:** `123456.78` = 123.45 km
- **Conversion:** meters ÷ 1000 = kilometers

### Duration

- **Unit:** Seconds (s)
- **Type:** Float
- **Example:** `7890.12` = 2 hours 11 minutes 30 seconds
- **Conversion:** seconds ÷ 60 = minutes, seconds ÷ 3600 = hours

### Coordinates

- **Format:** `[longitude, latitude]` (GeoJSON standard)
- **Type:** Array of Float
- **Range:**
  - Longitude: -180 to 180
  - Latitude: -90 to 90
- **Example:** `[106.8456, -6.2088]` (Jakarta)
- **Note:** Order is **lon, lat** (not lat, lon)

### Geometry Formats

#### GeoJSON (Default)

```json
{
  "type": "LineString",
  "coordinates": [
    [106.8456, -6.2088],
    [106.8467, -6.2095],
    [107.6191, -6.9175]
  ]
}
```

#### Polyline (Google format)

```
encoded_polyline_string
```

Use parameter `?geometries=polyline` for polyline format.

### Bearing

- **Unit:** Degrees (°)
- **Type:** Integer
- **Range:** 0-360
- **Reference:** 0 = North, 90 = East, 180 = South, 270 = West

---

## Response Examples

### Calculate Route - Full Response with Steps

```bash
GET /route?start=106.8456,-6.2088&end=107.6191,-6.9175&steps=true&alternatives=false
```

```json
{
  "code": "Ok",
  "routes": [
    {
      "distance": 123456.78,
      "duration": 7890.12,
      "weight": 7890.12,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [106.8456, -6.2088],
          [107.6191, -6.9175]
        ]
      },
      "legs": [
        {
          "distance": 123456.78,
          "duration": 7890.12,
          "weight": 7890.12,
          "summary": "Jalan Tol Jakarta - Bandung",
          "steps": [
            {
              "distance": 234.5,
              "duration": 45.2,
              "weight": 45.2,
              "name": "Jalan Sudirman",
              "mode": "driving",
              "maneuver": {
                "type": "depart",
                "location": [106.8456, -6.2088],
                "bearing_before": 0,
                "bearing_after": 90,
                "instruction": "Head east on Jalan Sudirman"
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
    }
  ]
}
```

---

## Support

For integration support:

- **Documentation:** See `BACKEND-INTEGRATION.md` for implementation examples
- **Deployment Guide:** See `DEPLOYMENT-GUIDE.md`
- **Issues:** Contact infrastructure team

---

**Last Updated:** December 10, 2025  
**API Version:** 1.0  
**OSRM Version:** 6.0.0
