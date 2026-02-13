# ============================================================================
# Setup Nominatim PostgreSQL+PostGIS for Offline Reverse Geocoding
# ============================================================================
# 
# Script ini akan:
# 1. Start PostgreSQL dan Nominatim containers
# 2. Import PBF file (java-latest.osm.pbf) ke PostgreSQL
# 3. Build geocoding index untuk reverse geocoding
#
# Requirements:
# - Docker Desktop running
# - PBF file: data/java-latest.osm.pbf (sudah ada)
# - RAM: 4-8GB available
# - Disk: 10-20GB untuk database
# - Time: 2-4 jam untuk import Java Island
#
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  NOMINATIM GEOCODING SETUP - JAVA ISLAND" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker
Write-Host "[1/6] Checking Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
    Write-Host "  ✅ Docker is available" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Docker is not installed or not running!" -ForegroundColor Red
    Write-Host "  Please install Docker Desktop and start it" -ForegroundColor Red
    exit 1
}

# Check PBF file
Write-Host ""
Write-Host "[2/6] Checking PBF file..." -ForegroundColor Yellow
$pbfFile = "data/java-latest.osm.pbf"
if (Test-Path $pbfFile) {
    $size = (Get-Item $pbfFile).Length / 1MB
    Write-Host "  ✅ PBF file found: $pbfFile ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
} else {
    Write-Host "  ❌ PBF file not found: $pbfFile" -ForegroundColor Red
    Write-Host "  Please run: .\MASTER-SETUP.ps1" -ForegroundColor Red
    exit 1
}

# Stop existing containers
Write-Host ""
Write-Host "[3/6] Stopping existing Nominatim containers..." -ForegroundColor Yellow
docker-compose stop nominatim postgres 2>$null
docker-compose rm -f nominatim postgres 2>$null
Write-Host "  ✅ Cleaned up old containers" -ForegroundColor Green

# Start PostgreSQL
Write-Host ""
Write-Host "[4/6] Starting PostgreSQL+PostGIS..." -ForegroundColor Yellow
docker-compose up -d postgres
Write-Host "  Waiting for PostgreSQL to be ready (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Check PostgreSQL health
$attempts = 0
$maxAttempts = 10
$postgresReady = $false

while ($attempts -lt $maxAttempts -and -not $postgresReady) {
    $attempts++
    Write-Host "  Checking PostgreSQL health (attempt $attempts/$maxAttempts)..." -ForegroundColor Yellow
    
    try {
        $healthCheck = docker exec osrm-postgres pg_isready -U nominatim 2>&1
        if ($healthCheck -like "*accepting connections*") {
            $postgresReady = $true
            Write-Host "  ✅ PostgreSQL is ready!" -ForegroundColor Green
        } else {
            Start-Sleep -Seconds 5
        }
    } catch {
        Start-Sleep -Seconds 5
    }
}

if (-not $postgresReady) {
    Write-Host "  ❌ PostgreSQL failed to start!" -ForegroundColor Red
    docker-compose logs postgres
    exit 1
}

# Start Nominatim (will import data on first run)
Write-Host ""
Write-Host "[5/6] Starting Nominatim (this will import PBF data)..." -ForegroundColor Yellow
Write-Host "  ⏳ This will take 2-4 HOURS for Java Island (~550MB PBF)" -ForegroundColor Yellow
Write-Host "  The import happens automatically on first start" -ForegroundColor Yellow
Write-Host ""
Write-Host "  You can monitor progress with:" -ForegroundColor Cyan
Write-Host "    docker-compose logs -f nominatim" -ForegroundColor White
Write-Host ""

docker-compose up -d nominatim

# Wait for Nominatim to start importing
Write-Host "  Waiting for import to begin (60 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

# Monitor import status
Write-Host ""
Write-Host "[6/6] Monitoring import status..." -ForegroundColor Yellow
Write-Host "  (Press Ctrl+C to stop monitoring, import will continue in background)" -ForegroundColor Cyan
Write-Host ""

$importComplete = $false
$checkCount = 0
$maxChecks = 720 # 6 hours max (30s intervals)

while ($checkCount -lt $maxChecks -and -not $importComplete) {
    $checkCount++
    
    try {
        # Check if Nominatim status endpoint is responding
        $status = Invoke-RestMethod -Uri "http://localhost:5002/status.php?format=json" -TimeoutSec 5 -ErrorAction SilentlyContinue
        
        if ($status.status -eq 0) {
            Write-Host "  ✅ NOMINATIM IMPORT COMPLETE!" -ForegroundColor Green
            $importComplete = $true
            break
        } else {
            Write-Host "  ⏳ Import in progress (check $checkCount)..." -ForegroundColor Yellow
        }
    } catch {
        # Still importing or service not ready
        Write-Host "  ⏳ Import in progress (check $checkCount)..." -ForegroundColor Yellow
    }
    
    # Show last 5 lines of logs every 10 checks (5 minutes)
    if ($checkCount % 10 -eq 0) {
        Write-Host ""
        Write-Host "  Latest logs:" -ForegroundColor Cyan
        docker-compose logs --tail 5 nominatim | ForEach-Object { Write-Host "    $_" -ForegroundColor White }
        Write-Host ""
    }
    
    Start-Sleep -Seconds 30
}

if ($importComplete) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  ✅ NOMINATIM SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Services running:" -ForegroundColor Cyan
    Write-Host "  - PostgreSQL: localhost:5432" -ForegroundColor White
    Write-Host "  - Nominatim: http://localhost:5002" -ForegroundColor White
    Write-Host ""
    Write-Host "Test reverse geocoding:" -ForegroundColor Cyan
    Write-Host "  curl 'http://localhost:5002/reverse?lat=-6.9175&lon=107.6191&format=json'" -ForegroundColor White
    Write-Host ""
    Write-Host "Now start the full stack:" -ForegroundColor Yellow
    Write-Host "  docker-compose up -d" -ForegroundColor White
    Write-Host ""
    Write-Host "Then test via your service:" -ForegroundColor Yellow
    Write-Host "  curl 'http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191'" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "  ⏳ IMPORT STILL RUNNING IN BACKGROUND" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The import is continuing in the background." -ForegroundColor Yellow
    Write-Host "Monitor with: docker-compose logs -f nominatim" -ForegroundColor White
    Write-Host ""
    Write-Host "Check status:" -ForegroundColor Yellow
    Write-Host "  curl http://localhost:5002/status.php?format=json" -ForegroundColor White
    Write-Host ""
}

Write-Host "Database location: Docker volume 'postgres-data'" -ForegroundColor Cyan
Write-Host "To remove and reimport: docker-compose down -v" -ForegroundColor Yellow
Write-Host ""
