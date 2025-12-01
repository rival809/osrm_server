# Quick Start Script untuk Windows
# Jalankan: .\START.ps1

Write-Host "🚀 OSRM Tile Service - Quick Start" -ForegroundColor Green
Write-Host ""

# Check Docker
Write-Host "📦 Checking Docker..." -ForegroundColor Cyan
$dockerRunning = docker ps 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker tidak running atau tidak terinstall" -ForegroundColor Red
    Write-Host "   Pastikan Docker Desktop sudah terinstall dan running" -ForegroundColor Yellow
    Write-Host "   Download: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Docker OK" -ForegroundColor Green

# Check if data exists
Write-Host ""
Write-Host "📊 Checking data..." -ForegroundColor Cyan
$pbfExists = Test-Path "data\java-latest.osm.pbf"
$osrmExists = Test-Path "data\java-latest.osrm"

if (-not $pbfExists) {
    Write-Host "⚠️  Data OSM belum didownload" -ForegroundColor Yellow
    Write-Host "   Jalankan: .\scripts\download-pbf.ps1" -ForegroundColor Yellow
} else {
    Write-Host "✅ PBF file exists" -ForegroundColor Green
}

if (-not $osrmExists) {
    Write-Host "⚠️  Data OSRM belum diproses" -ForegroundColor Yellow
    Write-Host "   Jalankan: .\scripts\process-osrm-v6.ps1" -ForegroundColor Yellow
} else {
    Write-Host "✅ OSRM files exist" -ForegroundColor Green
}

# Start services
Write-Host ""
Write-Host "🐳 Starting Docker services..." -ForegroundColor Cyan
docker-compose up -d osrm-backend

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ OSRM backend started" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to start OSRM" -ForegroundColor Red
    exit 1
}

# Wait for OSRM
Write-Host ""
Write-Host "⏳ Waiting for OSRM to be ready..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

# Check OSRM health
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000/route/v1/driving/107.6191,-6.9175;107.6098,-6.9145" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ OSRM is ready!" -ForegroundColor Green
} catch {
    Write-Host "⚠️  OSRM might still be starting..." -ForegroundColor Yellow
    Write-Host "   Check logs: docker logs osrm-backend" -ForegroundColor Yellow
}

# Start API server
Write-Host ""
Write-Host "🌐 Starting API server..." -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start Node.js server
npm start
