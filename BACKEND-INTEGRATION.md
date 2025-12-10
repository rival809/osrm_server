# Backend Sambara - OSRM Integration Guide

**Version:** 1.0  
**Framework:** Gin (Golang)  
**Last Updated:** December 10, 2025

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Implementation Guide](#implementation-guide)
  - [1. Service Layer](#1-service-layer)
  - [2. Controller Layer](#2-controller-layer)
  - [3. Router Setup](#3-router-setup)
  - [4. Main Application](#4-main-application)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Optional Features](#optional-features)
- [Error Handling](#error-handling)
- [Performance Tips](#performance-tips)

---

## Overview

This guide provides complete implementation for integrating OSRM Service into Backend Sambara using Gin Framework (Golang).

**Features:**

✅ RESTful API with standardized response format  
✅ Parameter validation and error handling  
✅ Route calculation with optional features  
✅ Map tile proxy with caching headers  
✅ Health check monitoring  
✅ Connection pooling and timeouts  
✅ Background health check worker (optional)

---

## Architecture

```
┌─────────────────┐
│  Mobile/Web App │
└────────┬────────┘
         │ HTTPS
         ↓
┌─────────────────────────────────┐
│   Backend Sambara (Gateway)     │
│   Port: 8080                    │
│                                 │
│  ┌──────────────────────────┐  │
│  │  OSRM Controller         │  │
│  │  - GetRoute()            │  │
│  │  - GetTile()             │  │
│  │  - HealthCheck()         │  │
│  └──────────┬───────────────┘  │
│             ↓                   │
│  ┌──────────────────────────┐  │
│  │  OSRM Service            │  │
│  │  - GetRoute()            │  │
│  │  - GetTile()             │  │
│  │  - HealthCheck()         │  │
│  └──────────┬───────────────┘  │
└─────────────┼───────────────────┘
              │ HTTP (Private)
              ↓
     ┌─────────────────┐
     │  OSRM Service   │
     │  Port: 80       │
     │  IP: 10.0.2.20  │
     └─────────────────┘
```

---

## Prerequisites

- **Golang:** 1.19+
- **Gin Framework:** github.com/gin-gonic/gin
- **Backend Sambara:** Existing helper functions
- **Network:** Access to OSRM service (private network)

**Required Packages:**

```bash
go get github.com/gin-gonic/gin
```

---

## Implementation Guide

### 1. Service Layer

Create `services/osrm_service.go`:

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

// OSRMService interface defines routing service operations
type OSRMService interface {
    GetRoute(startLon, startLat, endLon, endLat string, alternatives, steps bool) (map[string]interface{}, error)
    GetTile(z, x, y string) ([]byte, error)
    HealthCheck() (map[string]interface{}, error)
}

type osrmService struct {
    baseURL string
    client  *http.Client
}

// NewOSRMService creates new OSRM service instance
func NewOSRMService() OSRMService {
    osrmURL := os.Getenv("OSRM_SERVICE_URL")
    if osrmURL == "" {
        osrmURL = "http://10.0.2.20" // Default internal IP
    }

    return &osrmService{
        baseURL: osrmURL,
        client: &http.Client{
            Timeout: 30 * time.Second,
            Transport: &http.Transport{
                MaxIdleConns:        100,
                MaxIdleConnsPerHost: 10,
                IdleConnTimeout:     90 * time.Second,
            },
        },
    }
}

// GetRoute calculates route between two points
func (s *osrmService) GetRoute(startLon, startLat, endLon, endLat string, alternatives, steps bool) (map[string]interface{}, error) {
    // Build OSRM URL
    url := fmt.Sprintf("%s/route?start=%s,%s&end=%s,%s&alternatives=%t&steps=%t",
        s.baseURL, startLon, startLat, endLon, endLat, alternatives, steps)

    // Make HTTP request
    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("routing service unavailable: %v", err)
    }
    defer resp.Body.Close()

    // Check response status
    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("routing request failed with status %d: %s", resp.StatusCode, string(body))
    }

    // Parse JSON response
    var result map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, fmt.Errorf("failed to parse routing response: %v", err)
    }

    // Check OSRM response code
    if code, ok := result["code"].(string); ok && code != "Ok" {
        message := "Unknown error"
        if msg, ok := result["message"].(string); ok {
            message = msg
        }
        return nil, fmt.Errorf("routing error: %s - %s", code, message)
    }

    return result, nil
}

// GetTile retrieves map tile image
func (s *osrmService) GetTile(z, x, y string) ([]byte, error) {
    // Build tile URL
    url := fmt.Sprintf("%s/tiles/%s/%s/%s.png", s.baseURL, z, x, y)

    // Make HTTP request
    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("tile service unavailable: %v", err)
    }
    defer resp.Body.Close()

    // Check response status
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("tile not found")
    }

    // Read tile binary data
    tileData, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("failed to read tile data: %v", err)
    }

    return tileData, nil
}

// HealthCheck checks OSRM service health
func (s *osrmService) HealthCheck() (map[string]interface{}, error) {
    url := fmt.Sprintf("%s/health", s.baseURL)

    resp, err := s.client.Get(url)
    if err != nil {
        return nil, fmt.Errorf("health check failed: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("health check returned status %d", resp.StatusCode)
    }

    var health map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
        return nil, fmt.Errorf("failed to parse health response: %v", err)
    }

    return health, nil
}
```

---

### 2. Controller Layer

Create `controllers/osrm_controller.go`:

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

// NewOSRMController creates new OSRM controller instance
func NewOSRMController(s services.OSRMService) *OSRMController {
    return &OSRMController{s}
}

// GetRoute handles route calculation requests
// @Summary Calculate route between two points
// @Description Calculate optimal route with optional alternatives and turn-by-turn steps
// @Tags OSRM
// @Accept json
// @Produce json
// @Param start_lon query string true "Start longitude"
// @Param start_lat query string true "Start latitude"
// @Param end_lon query string true "End longitude"
// @Param end_lat query string true "End latitude"
// @Param alternatives query string false "Return alternative routes (true/false)"
// @Param steps query string false "Include navigation steps (true/false)"
// @Success 200 {object} helper.Response
// @Failure 400 {object} helper.Response
// @Failure 500 {object} helper.Response
// @Router /api/v1/osrm/route [get]
func (c *OSRMController) GetRoute(ctx *gin.Context) {
    allParams := helper.GetAllParamsOnly(ctx)

    // Define required parameters
    requiredParams := map[string]string{
        "start_lon": "string",
        "start_lat": "string",
        "end_lon":   "string",
        "end_lat":   "string",
    }

    // Validate parameters
    params, err := helper.GetAllParamsWithValidation(ctx, requiredParams)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusBadRequest, err.Error(), allParams)
        return
    }

    // Extract parameters
    startLon := params["start_lon"]
    startLat := params["start_lat"]
    endLon := params["end_lon"]
    endLat := params["end_lat"]

    // Optional parameters with defaults
    alternatives := ctx.DefaultQuery("alternatives", "false") == "true"
    steps := ctx.DefaultQuery("steps", "false") == "true"

    // Call service
    data, err := c.service.GetRoute(startLon, startLat, endLon, endLat, alternatives, steps)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusInternalServerError, err.Error(), params)
        return
    }

    // Send success response
    helper.SendSuccessResponse(ctx, data, params)
}

// GetTile handles map tile requests
// @Summary Get map tile image
// @Description Retrieve map tile for displaying maps
// @Tags OSRM
// @Produce image/png
// @Param z path string true "Zoom level (0-18)"
// @Param x path string true "Tile X coordinate"
// @Param y path string true "Tile Y coordinate"
// @Success 200 {file} image/png
// @Failure 404 {object} helper.Response
// @Router /api/v1/osrm/tiles/{z}/{x}/{y} [get]
func (c *OSRMController) GetTile(ctx *gin.Context) {
    // Extract path parameters
    z := ctx.Param("z")
    x := ctx.Param("x")
    y := ctx.Param("y")

    // Validate parameters
    if z == "" || x == "" || y == "" {
        helper.SendErrorResponse(ctx, http.StatusBadRequest, "Invalid tile coordinates", nil)
        return
    }

    // Call service
    tileData, err := c.service.GetTile(z, x, y)
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusNotFound, err.Error(), nil)
        return
    }

    // Return tile image with caching headers
    ctx.Header("Content-Type", "image/png")
    ctx.Header("Cache-Control", "public, max-age=86400") // 24 hours
    ctx.Data(http.StatusOK, "image/png", tileData)
}

// HealthCheck checks OSRM service status
// @Summary Health check
// @Description Check OSRM service health and availability
// @Tags OSRM
// @Produce json
// @Success 200 {object} helper.Response
// @Failure 503 {object} helper.Response
// @Router /api/v1/osrm/health [get]
func (c *OSRMController) HealthCheck(ctx *gin.Context) {
    data, err := c.service.HealthCheck()
    if err != nil {
        helper.SendErrorResponse(ctx, http.StatusServiceUnavailable, err.Error(), nil)
        return
    }
    helper.SendSuccessResponse(ctx, data, nil)
}
```

---

### 3. Router Setup

Create `routes/osrm_routes.go`:

```go
package routes

import (
    "sambara-go-lang/controllers"
    "sambara-go-lang/services"

    "github.com/gin-gonic/gin"
)

// SetupOSRMRoutes configures OSRM routing endpoints
func SetupOSRMRoutes(router *gin.RouterGroup) {
    // Initialize service and controller
    osrmService := services.NewOSRMService()
    osrmController := controllers.NewOSRMController(osrmService)

    // OSRM route group
    osrm := router.Group("/osrm")
    {
        // Route calculation
        osrm.GET("/route", osrmController.GetRoute)

        // Map tiles
        osrm.GET("/tiles/:z/:x/:y", osrmController.GetTile)

        // Health check
        osrm.GET("/health", osrmController.HealthCheck)
    }
}
```

---

### 4. Main Application

Update `main.go`:

```go
package main

import (
    "log"
    "sambara-go-lang/routes"

    "github.com/gin-gonic/gin"
)

func main() {
    // Set Gin mode
    gin.SetMode(gin.ReleaseMode)

    // Create router
    r := gin.Default()

    // Health check for load balancer
    r.GET("/ping", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok"})
    })

    // API v1 group
    api := r.Group("/api/v1")
    {
        // ... existing routes ...

        // OSRM routes
        routes.SetupOSRMRoutes(api)

        // ... other routes ...
    }

    // Start server
    port := ":8080"
    log.Printf("🚀 Backend Sambara starting on %s", port)
    if err := r.Run(port); err != nil {
        log.Fatalf("Failed to start server: %v", err)
    }
}
```

---

## Configuration

### Environment Variables

Create or update `.env` file:

```bash
# OSRM Service Configuration
OSRM_SERVICE_URL=http://10.0.2.20    # Internal OSRM service IP
OSRM_TIMEOUT=30                       # Request timeout in seconds (optional)

# Application
APP_ENV=production
APP_PORT=8080
```

### Load Environment Variables

```go
package config

import (
    "log"
    "os"

    "github.com/joho/godotenv"
)

func LoadEnv() {
    if err := godotenv.Load(); err != nil {
        log.Println("No .env file found, using system environment variables")
    }
}

func GetOSRMURL() string {
    url := os.Getenv("OSRM_SERVICE_URL")
    if url == "" {
        return "http://10.0.2.20" // Default
    }
    return url
}
```

---

## Usage Examples

### 1. Calculate Route

**Request:**

```bash
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175"
```

**Response:**

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
        }
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

### 2. Calculate Route with Steps

**Request:**

```bash
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175&steps=true"
```

### 3. Get Map Tile

**Request:**

```bash
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/tiles/10/511/511" --output tile.png
```

### 4. Health Check

**Request:**

```bash
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/health"
```

**Response:**

```json
{
  "status": "success",
  "message": "Success",
  "data": {
    "status": "healthy",
    "uptime": 86400,
    "services": {
      "osrm_backend": "running"
    }
  },
  "params": null
}
```

---

## Testing

### Unit Test Example

Create `controllers/osrm_controller_test.go`:

```go
package controllers

import (
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/gin-gonic/gin"
    "github.com/stretchr/testify/assert"
)

func TestGetRoute(t *testing.T) {
    gin.SetMode(gin.TestMode)

    // Setup
    router := gin.Default()
    mockService := &MockOSRMService{}
    controller := NewOSRMController(mockService)

    router.GET("/route", controller.GetRoute)

    // Test valid request
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175", nil)
    router.ServeHTTP(w, req)

    assert.Equal(t, http.StatusOK, w.Code)
    assert.Contains(t, w.Body.String(), "success")
}

func TestGetRoute_MissingParams(t *testing.T) {
    gin.SetMode(gin.TestMode)

    router := gin.Default()
    mockService := &MockOSRMService{}
    controller := NewOSRMController(mockService)

    router.GET("/route", controller.GetRoute)

    // Test missing parameters
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/route?start_lon=106.8456", nil)
    router.ServeHTTP(w, req)

    assert.Equal(t, http.StatusBadRequest, w.Code)
}
```

### Integration Test

```bash
# Test route endpoint
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/route?start_lon=106.8456&start_lat=-6.2088&end_lon=107.6191&end_lat=-6.9175" | jq

# Test tile endpoint
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/tiles/10/511/511" --output /tmp/test_tile.png && file /tmp/test_tile.png

# Test health endpoint
curl -X GET "http://192.168.99.130:8080/api/v1/osrm/health" | jq
```

---

## Optional Features

### 1. Background Health Check Worker

Create `workers/osrm_health_worker.go`:

```go
package workers

import (
    "log"
    "sambara-go-lang/services"
    "time"
)

// StartOSRMHealthCheck monitors OSRM service health
func StartOSRMHealthCheck(service services.OSRMService) {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()

    log.Println("🏥 OSRM Health Check Worker started")

    for range ticker.C {
        health, err := service.HealthCheck()
        if err != nil {
            log.Printf("⚠️  OSRM Health Check FAILED: %v", err)
            // TODO: Send alert notification (email, Slack, etc.)
            continue
        }

        if status, ok := health["status"].(string); ok {
            log.Printf("✅ OSRM Status: %s", status)
        }
    }
}
```

**Start worker in `main.go`:**

```go
import "sambara-go-lang/workers"

func main() {
    // ... router setup ...

    // Start health check worker
    osrmService := services.NewOSRMService()
    go workers.StartOSRMHealthCheck(osrmService)

    // ... start server ...
}
```

### 2. Request Logging Middleware

```go
package middleware

import (
    "log"
    "time"

    "github.com/gin-gonic/gin"
)

func OSRMLogger() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        path := c.Request.URL.Path

        c.Next()

        duration := time.Since(start)
        status := c.Writer.Status()

        log.Printf("[OSRM] %s %s - Status: %d - Duration: %v",
            c.Request.Method,
            path,
            status,
            duration,
        )
    }
}
```

**Usage:**

```go
osrm := router.Group("/osrm")
osrm.Use(middleware.OSRMLogger())
{
    osrm.GET("/route", osrmController.GetRoute)
    // ...
}
```

### 3. Response Caching

```go
package middleware

import (
    "time"

    "github.com/gin-contrib/cache"
    "github.com/gin-contrib/cache/persistence"
    "github.com/gin-gonic/gin"
)

func SetupCaching() *persistence.InMemoryStore {
    return persistence.NewInMemoryStore(5 * time.Minute)
}

// In routes setup:
store := middleware.SetupCaching()
osrm.GET("/tiles/:z/:x/:y", cache.CachePage(store, 24*time.Hour, osrmController.GetTile))
```

---

## Error Handling

### Standard Error Responses

All errors follow Backend Sambara standard format:

```json
{
  "status": "error",
  "message": "Error description",
  "data": null,
  "params": {}
}
```

### Common Error Scenarios

#### 1. Missing Parameters

```json
{
  "status": "error",
  "message": "Missing required parameters: start_lon",
  "data": null,
  "params": {}
}
```

#### 2. OSRM Service Unavailable

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

#### 3. No Route Found

```json
{
  "status": "error",
  "message": "routing error: NoRoute - No route found between coordinates",
  "data": null,
  "params": {...}
}
```

---

## Performance Tips

### 1. Connection Pooling

Already implemented in service layer:

```go
Transport: &http.Transport{
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 10,
    IdleConnTimeout:     90 * time.Second,
}
```

### 2. Request Timeout

```go
client: &http.Client{
    Timeout: 30 * time.Second,
}
```

### 3. Response Compression

Enable Gzip in Gin:

```go
import "github.com/gin-contrib/gzip"

r.Use(gzip.Gzip(gzip.DefaultCompression))
```

### 4. Tile Caching Headers

Already set in controller:

```go
ctx.Header("Cache-Control", "public, max-age=86400") // 24 hours
```

### 5. Concurrent Requests

Use goroutines for batch operations:

```go
type RouteRequest struct {
    StartLon, StartLat, EndLon, EndLat string
}

func (s *osrmService) GetMultipleRoutes(requests []RouteRequest) []map[string]interface{} {
    results := make([]map[string]interface{}, len(requests))
    var wg sync.WaitGroup

    for i, req := range requests {
        wg.Add(1)
        go func(index int, r RouteRequest) {
            defer wg.Done()
            result, _ := s.GetRoute(r.StartLon, r.StartLat, r.EndLon, r.EndLat, false, false)
            results[index] = result
        }(i, req)
    }

    wg.Wait()
    return results
}
```

---

## Monitoring & Logging

### 1. Structured Logging

```go
import "go.uber.org/zap"

logger, _ := zap.NewProduction()
defer logger.Sync()

logger.Info("OSRM request",
    zap.String("endpoint", "route"),
    zap.String("start", fmt.Sprintf("%s,%s", startLon, startLat)),
    zap.String("end", fmt.Sprintf("%s,%s", endLon, endLat)),
    zap.Duration("duration", duration),
)
```

### 2. Metrics Collection

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    osrmRequestTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "osrm_requests_total",
            Help: "Total number of OSRM requests",
        },
        []string{"endpoint", "status"},
    )
)
```

---

## Security Considerations

1. **Network Security**

   - OSRM service should be on private network
   - Use firewall rules to restrict access
   - No public internet exposure

2. **Input Validation**

   - Validate coordinate ranges
   - Sanitize parameters
   - Check zoom level bounds (0-18)

3. **Rate Limiting**

   - Implement at gateway level
   - Prevent abuse

4. **Monitoring**
   - Track failed requests
   - Monitor service health
   - Alert on anomalies

---

## Troubleshooting

### Issue: Connection Refused

```bash
# Check OSRM service
curl http://10.0.2.20/health

# Check network connectivity
ping 10.0.2.20

# Verify environment variable
echo $OSRM_SERVICE_URL
```

### Issue: Slow Response

```bash
# Check OSRM service load
docker stats osrm-backend

# Monitor network latency
curl -w "@curl-format.txt" http://10.0.2.20/health
```

### Issue: No Route Found

- Verify coordinates are within Java Island
- Check if coordinates are on road network
- Try alternative routes with `alternatives=true`

---

## Support

- **API Specification:** See `API-SPECIFICATION.md`
- **Deployment Guide:** See `DEPLOYMENT-GUIDE.md`
- **OSRM Docs:** https://project-osrm.org/docs/v5.24.0/api/

---

**Last Updated:** December 10, 2025  
**Framework:** Gin v1.9+  
**Go Version:** 1.19+
