# 📐 Arsitektur System

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Browser                          │
│                  (Leaflet Map Interface)                     │
└────────────┬────────────────────────────────────────────────┘
             │
             │ HTTP Requests
             ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js Express API Server                      │
│                    (Port 8080)                               │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Routing    │  │    Tiles     │  │  Geocoding   │     │
│  │   Handler    │  │   Handler    │  │   Handler    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │              │
│  ┌──────▼──────────────────▼──────────────────▼───────┐    │
│  │           Node-Cache (In-Memory)                   │    │
│  │            TTL: 1 hour                              │    │
│  └─────────────────────────────────────────────────────┘    │
└────────┬───────────────────┬───────────────────┬────────────┘
         │                   │                   │
         │                   │                   │
    ┌────▼────┐         ┌────▼────┐        ┌────▼─────┐
    │  OSRM   │         │   OSM   │        │ Nominatim│
    │ Backend │         │  Tiles  │        │   API    │
    │(Docker) │         │ (Proxy) │        │ (Public) │
    └────┬────┘         └─────────┘        └──────────┘
         │
    ┌────▼────────────┐
    │  Vector Data    │
    │ (PBF → OSRM)    │
    │ java-latest.osm │
    └─────────────────┘
```

## Komponen Utama

### 1. **Frontend (Client)**

- **Technology:** Leaflet.js
- **Location:** `public/index.html`
- **Features:**
  - Interactive map
  - Route planning
  - Click to set waypoints
  - Display route info (distance, duration)

### 2. **API Server (Backend)**

- **Technology:** Node.js + Express
- **Location:** `src/server.js`
- **Port:** 8080
- **Features:**
  - RESTful API endpoints
  - Request routing & validation
  - Response caching
  - Regional filtering (Jawa Barat)
  - Error handling

### 3. **Caching Layer**

- **Technology:** node-cache
- **Type:** In-memory
- **TTL:** 3600 seconds (1 hour)
- **Purpose:**
  - Reduce external API calls
  - Improve response time
  - Save bandwidth

### 4. **OSRM Backend**

- **Technology:** Open Source Routing Machine
- **Deployment:** Docker container
- **Port:** 5000
- **Data Source:** `data/java-latest.osrm`
- **Profile:** Car/driving
- **Algorithm:** MLD (Multi-Level Dijkstra)

### 5. **Tile Service**

- **Mode 1 - Proxy (Default):**
  - Source: OpenStreetMap tile servers
  - No local storage needed
  - Good for development
- **Mode 2 - Render (Advanced):**
  - Source: PostgreSQL + PostGIS
  - Local vector data
  - Custom styling possible

### 6. **Database (Optional)**

- **Technology:** PostgreSQL 15 + PostGIS 3.3
- **Port:** 5432
- **Purpose:**
  - Store vector map data
  - Geocoding queries
  - Custom tile rendering
- **Size:** ~50GB for Java island

## Data Flow

### Routing Request Flow

```
1. User clicks map → Sets start/end points
2. Frontend → GET /route?start=lon,lat&end=lon,lat
3. API Server → Validate coordinates (Jawa Barat only)
4. API Server → Check cache
5. If cache miss:
   a. API Server → OSRM Backend
   b. OSRM → Calculate route
   c. OSRM → Return route data
   d. API Server → Cache result
6. API Server → Return JSON response
7. Frontend → Draw route on map
```

### Tile Request Flow

```
1. Map needs tile → GET /tiles/{z}/{x}/{y}.png
2. API Server → Check cache
3. If cache miss:
   [Proxy Mode]
   a. API Server → OpenStreetMap tile server
   b. OSM → Return PNG tile
   c. API Server → Cache tile

   [Render Mode]
   a. API Server → Query PostGIS
   b. PostGIS → Return vector data
   c. API Server → Render to PNG
   d. API Server → Cache tile
4. API Server → Return PNG image
5. Map → Display tile
```

## Security Layers

### 1. Regional Filtering

```javascript
// Jawa Barat bounds
{
  minLon: 104.5,
  minLat: -7.8,
  maxLon: 108.8,
  maxLat: -5.8
}
```

- Requests outside bounds → Rejected
- Reduces abuse and unnecessary processing

### 2. Rate Limiting (TODO)

- Planned for production
- Prevent API abuse
- Protect external services

### 3. CORS Configuration

```javascript
app.use(cors());
```

- Currently: Allow all origins
- Production: Restrict to specific domains

### 4. Input Validation

- Coordinate format validation
- Zoom level limits (0-18)
- Query parameter sanitization

## Performance Optimization

### 1. Caching Strategy

- **Tiles:** 1 hour TTL
- **Routes:** 1 hour TTL
- **In-memory:** Fast access
- **LRU eviction:** Automatic cleanup

### 2. Regional Focus

- Only process Jawa Barat requests
- Smaller data footprint
- Faster queries

### 3. Docker Containers

- OSRM isolated
- Resource limits configurable
- Easy scaling

### 4. Compression (TODO)

- Gzip responses
- Reduce bandwidth

## Deployment Architecture

### Development

```
Laptop/Desktop
├── Node.js (API Server) - Native
└── Docker Desktop
    ├── OSRM Backend
    └── PostgreSQL (optional)
```

### Production

```
Cloud Server (e.g., AWS, Azure, GCP)
├── Docker Compose
│   ├── Nginx (Reverse Proxy)
│   ├── Node.js API Server (x2 replicas)
│   ├── OSRM Backend
│   └── PostgreSQL + PostGIS
└── Storage
    ├── Vector data (persistent volume)
    └── Cache (ephemeral)
```

## Monitoring Points (TODO)

1. **API Response Times**

   - Average latency
   - P95, P99 percentiles

2. **Cache Hit Rates**

   - Tile cache efficiency
   - Route cache efficiency

3. **External API Calls**

   - OSM tile requests
   - Nominatim requests

4. **Resource Usage**
   - Memory (cache size)
   - CPU (rendering load)
   - Disk I/O

## Scalability Considerations

### Horizontal Scaling

- Multiple API server instances
- Load balancer (Nginx)
- Shared cache (Redis) instead of in-memory

### Vertical Scaling

- More RAM for caching
- More CPU for rendering
- SSD for database

### Database Sharding

- Split by region
- Separate read replicas
- Query optimization

---

**Version:** 1.0  
**Last Updated:** 2025-11-28
