# Complete OSRM Processing Script
# This script will process OSM PBF file for OSRM routing

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OSRM Data Processing for Java" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if PBF file exists
$pbfFile = "data\java-latest.osm.pbf"
if (-not (Test-Path $pbfFile)) {
    Write-Host "ERROR: PBF file not found!" -ForegroundColor Red
    Write-Host "Expected: $pbfFile" -ForegroundColor Yellow
    Write-Host "Run: .\scripts\download-pbf.ps1" -ForegroundColor Yellow
    exit 1
}

$fileSize = [math]::Round((Get-Item $pbfFile).Length / 1MB, 2)
Write-Host "Found PBF file: $fileSize MB" -ForegroundColor Green
Write-Host ""

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor Cyan
try {
    $dockerVersion = docker --version 2>$null
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Host "Docker OK: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Docker not available!" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again" -ForegroundColor Yellow
    exit 1
}

# Check if Docker is running
try {
    docker ps >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker daemon not running!" -ForegroundColor Red
        Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        Write-Host "Waiting 30 seconds for Docker to start..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
        
        docker ps >$null 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Docker still not ready!" -ForegroundColor Red
            Write-Host "Please start Docker Desktop manually and run this script again" -ForegroundColor Yellow
            exit 1
        }
    }
    Write-Host "Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Cannot connect to Docker!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starting OSRM processing..." -ForegroundColor Cyan
Write-Host "This will take 10-30 minutes depending on your CPU" -ForegroundColor Yellow
Write-Host ""

# Get absolute path for Docker volume mount
$dataPath = (Resolve-Path "data").Path

# Step 1: Extract
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Step 1/3: Extract (5-10 minutes)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

docker run -t -v "${dataPath}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Extract failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Extract complete!" -ForegroundColor Green
Write-Host ""

# Step 2: Partition
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Step 2/3: Partition (3-5 minutes)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

docker run -t -v "${dataPath}:/data" osrm/osrm-backend osrm-partition /data/java-latest.osrm

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Partition failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Partition complete!" -ForegroundColor Green
Write-Host ""

# Step 3: Customize
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Step 3/3: Customize (2-3 minutes)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

docker run -t -v "${dataPath}:/data" osrm/osrm-backend osrm-customize /data/java-latest.osrm

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Customize failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  OSRM Processing Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# List generated files
Write-Host "Generated files:" -ForegroundColor Cyan
Get-ChildItem data\*.osrm* | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  - $($_.Name) ($sizeMB MB)" -ForegroundColor White
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Start services: docker-compose up -d" -ForegroundColor White
Write-Host "  2. Or use quick start: .\START.ps1" -ForegroundColor White
Write-Host "  3. Open browser: http://localhost:8080" -ForegroundColor White
Write-Host ""
