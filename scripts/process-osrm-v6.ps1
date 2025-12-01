# Script untuk memproses PBF file dengan OSRM v6.0.0
# Menggunakan image yang sama dengan docker-compose

Write-Host "Processing OSM data for OSRM v6.0.0..." -ForegroundColor Green
Write-Host "This process requires 10-30 minutes depending on computer specs" -ForegroundColor Yellow

$DATA_DIR = ".\data"
$PBF_FILE = "$DATA_DIR\java-latest.osm.pbf"

# Check if PBF file exists
if (-not (Test-Path $PBF_FILE)) {
    Write-Host "PBF file not found: $PBF_FILE" -ForegroundColor Red
    Write-Host "Run: .\scripts\download-pbf.ps1" -ForegroundColor Yellow
    exit 1
}

# Get absolute path
$ABSOLUTE_DATA_DIR = (Resolve-Path $DATA_DIR).Path

# Use the same image as docker-compose
$OSRM_IMAGE = "ghcr.io/project-osrm/osrm-backend:v6.0.0"

# Extract
Write-Host "Step 1/3: Extract..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
if ($LASTEXITCODE -ne 0) { 
    Write-Host "Extract failed" -ForegroundColor Red
    exit 1 
}

# Partition
Write-Host "Step 2/3: Partition..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-partition /data/java-latest.osrm
if ($LASTEXITCODE -ne 0) { 
    Write-Host "Partition failed" -ForegroundColor Red
    exit 1 
}

# Customize
Write-Host "Step 3/3: Customize..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-customize /data/java-latest.osrm
if ($LASTEXITCODE -ne 0) { 
    Write-Host "Customize failed" -ForegroundColor Red
    exit 1 
}

Write-Host "OSRM processing completed successfully!" -ForegroundColor Green
Write-Host "Files created:" -ForegroundColor Cyan
Write-Host "- java-latest.osrm" -ForegroundColor White
Write-Host "- java-latest.osrm.hsgr" -ForegroundColor White  
Write-Host "- java-latest.osrm.ch" -ForegroundColor White