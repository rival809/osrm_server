# COMPLETE-SETUP.ps1
# Complete setup script for OSRM service with tile caching

Write-Host "OSRM Service Complete Setup" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Gray
Write-Host ""
Write-Host "This script will set up your OSRM service with tile caching:" -ForegroundColor White
Write-Host "  1. Install dependencies" -ForegroundColor Gray
Write-Host "  2. Download OSM data (if needed)" -ForegroundColor Gray  
Write-Host "  3. Process OSRM data" -ForegroundColor Gray
Write-Host "  4. Start OSRM backend" -ForegroundColor Gray
Write-Host "  5. Start API server" -ForegroundColor Gray
Write-Host ""

# Function to pause and wait for user input
function Wait-Continue {
    Write-Host "Press any key to continue..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Write-Host ""
}

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "   Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "   Node.js not found" -ForegroundColor Red
    Write-Host "      Please install Node.js from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

# Check Docker
try {
    $dockerVersion = docker --version 2>$null
    Write-Host "   Docker: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "   Docker not found" -ForegroundColor Red
    Write-Host "      Please install Docker Desktop" -ForegroundColor Yellow
    exit 1
}

# Check if Docker is running
try {
    docker ps 2>$null | Out-Null
    Write-Host "   Docker is running" -ForegroundColor Green
} catch {
    Write-Host "   Docker is not running" -ForegroundColor Red
    Write-Host "      Please start Docker Desktop" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "All prerequisites OK! Starting setup..." -ForegroundColor Green

# Step 1: Install Dependencies
Write-Host ""
Write-Host ("=" * 50)
Write-Host "Step 1/5: Installing Dependencies" -ForegroundColor Green
Write-Host ("=" * 50)
try {
    npm install
    Write-Host "Dependencies installed successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Wait-Continue

# Step 2: Download OSM Data (if not exists)
Write-Host ""
Write-Host ("=" * 50)
Write-Host "Step 2/5: OSM Data" -ForegroundColor Green
Write-Host ("=" * 50)

$pbfFile = "data\java-latest.osm.pbf"
if (Test-Path $pbfFile) {
    $fileSize = [math]::Round((Get-Item $pbfFile).Length / 1MB, 2)
    Write-Host "OSM data already exists: $fileSize MB" -ForegroundColor Green
} else {
    Write-Host "Downloading OSM data for Java..." -ForegroundColor Cyan
    Write-Host "This will download ~180MB, may take several minutes" -ForegroundColor Yellow
    Write-Host ""
    
    try {
        & ".\scripts\download-pbf.ps1"
        Write-Host "OSM data downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Host "Failed to download OSM data" -ForegroundColor Red
        exit 1
    }
}

Wait-Continue

# Step 3: Process OSRM Data
Write-Host ""
Write-Host ("=" * 50)
Write-Host "Step 3/5: Processing OSRM Data" -ForegroundColor Green
Write-Host ("=" * 50)

# Check if OSRM files exist
$osrmFiles = @("data\java-latest.osrm", "data\java-latest.osrm.hsgr", "data\java-latest.osrm.ch")
$missingFiles = @()
foreach ($file in $osrmFiles) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -eq 0) {
    Write-Host "OSRM data already processed" -ForegroundColor Green
} else {
    Write-Host "Processing OSRM data (extract, partition, customize)..." -ForegroundColor Cyan
    Write-Host "This may take several minutes" -ForegroundColor Yellow
    Write-Host ""
    
    try {
        & ".\scripts\process-osrm-v6.ps1"
        Write-Host "OSRM data processed successfully" -ForegroundColor Green
    } catch {
        Write-Host "Failed to process OSRM data" -ForegroundColor Red
        exit 1
    }
}

Wait-Continue

# Step 4: Start OSRM Backend
Write-Host ""
Write-Host ("=" * 50)
Write-Host "Step 4/5: Starting OSRM Backend" -ForegroundColor Green
Write-Host ("=" * 50)

Write-Host "Starting OSRM backend container..." -ForegroundColor Cyan
try {
    docker-compose up -d osrm-backend
    Start-Sleep -Seconds 10
    
    # Test OSRM health
    Write-Host "Testing OSRM backend..." -ForegroundColor Cyan
    $response = Invoke-WebRequest -Uri "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -eq 200) {
        Write-Host "OSRM backend is running and healthy" -ForegroundColor Green
    } else {
        throw "OSRM health check failed"
    }
} catch {
    Write-Host "Failed to start OSRM backend: $_" -ForegroundColor Red
    exit 1
}

Wait-Continue

# Step 5: Setup Complete & Start API Server
Write-Host ""
Write-Host ("=" * 50)
Write-Host "Step 5/5: Starting API Server" -ForegroundColor Green  
Write-Host ("=" * 50)

Write-Host "Setup completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "System Status:" -ForegroundColor Cyan
Write-Host "   OSM Data: Ready (Jawa Barat)" -ForegroundColor Green
Write-Host "   OSRM Backend: Running (Port 5000)" -ForegroundColor Green
Write-Host "   Cache System: Ready" -ForegroundColor Green
Write-Host ""
Write-Host "Starting API server..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Available endpoints:" -ForegroundColor White
Write-Host "   http://localhost:3000/route - Routing API" -ForegroundColor Gray
Write-Host "   http://localhost:3000/tiles/{z}/{x}/{y}.png - Tiles API" -ForegroundColor Gray
Write-Host "   http://localhost:3000/cache/stats - Cache statistics" -ForegroundColor Gray
Write-Host "   http://localhost:3000/ - Web interface" -ForegroundColor Gray
Write-Host ""
Write-Host "To manage cache and preload tiles, run:" -ForegroundColor Gray
Write-Host "   .\CACHE-MANAGER.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop the server when done." -ForegroundColor Yellow
Write-Host ""
Write-Host ("=" * 50)
Write-Host ""

# Start API server
npm start