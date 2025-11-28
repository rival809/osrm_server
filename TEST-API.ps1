# Test API Script
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  Testing OSRM Tile Service API" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health Check
Write-Host "1. Health Check" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod "http://localhost:8080/health"
    Write-Host "   Status: $($health.status)" -ForegroundColor Green
    Write-Host "   Service: $($health.service)" -ForegroundColor Green
    Write-Host "   Region: $($health.region)" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Cannot connect to API server" -ForegroundColor Red
    Write-Host "   Make sure server is running: npm start" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Test 2: Routing
Write-Host "2. Test Routing (Bandung area)" -ForegroundColor Yellow
try {
    $route = Invoke-RestMethod "http://localhost:8080/route?start=107.6191,-6.9175&end=107.6098,-6.9145"
    Write-Host "   Success: $($route.success)" -ForegroundColor Green
    Write-Host "   Region: $($route.region)" -ForegroundColor Green
    if ($route.data.routes) {
        $distance = [math]::Round($route.data.routes[0].distance / 1000, 2)
        $duration = [math]::Round($route.data.routes[0].duration / 60, 1)
        Write-Host "   Distance: $distance km" -ForegroundColor Green
        Write-Host "   Duration: $duration minutes" -ForegroundColor Green
    }
} catch {
    Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 3: Tiles
Write-Host "3. Test Tile Request" -ForegroundColor Yellow
try {
    $tile = Invoke-WebRequest "http://localhost:8080/tiles/10/897/650.png" -UseBasicParsing
    Write-Host "   Status: $($tile.StatusCode)" -ForegroundColor Green
    Write-Host "   Content-Type: $($tile.Headers['Content-Type'])" -ForegroundColor Green
    Write-Host "   Cache: $($tile.Headers['X-Cache'])" -ForegroundColor Green
    Write-Host "   Size: $($tile.Content.Length) bytes" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  All Tests Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Open in browser: http://localhost:8080" -ForegroundColor Cyan
