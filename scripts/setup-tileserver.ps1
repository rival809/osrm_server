# ========================================================================
# Setup Local Tile Server from PBF File
# Works on: Windows 10/11 with Docker Desktop
# 
# This script sets up tileserver-gl to generate tiles from your PBF file
# instead of downloading from tile.openstreetmap.org
# ========================================================================

# Configuration
$PbfFile = ".\data\java-latest.osm.pbf"
$MbtilesFile = ".\data\java.mbtiles"
$TileserverPort = 5001
$DockerImage = "maptiler/tileserver-gl:latest"

# Function to print colored output
function Write-Header {
    param([string]$Message)
    Write-Host "========================================" -ForegroundColor Blue
    Write-Host $Message -ForegroundColor Blue
    Write-Host "========================================" -ForegroundColor Blue
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

# Check if Docker is installed
function Test-Docker {
    Write-Info "Checking Docker installation..."
    
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker is not installed!"
        Write-Host ""
        Write-Host "Install Docker Desktop for Windows:"
        Write-Host "  https://www.docker.com/products/docker-desktop"
        exit 1
    }
    
    $dockerVersion = docker --version
    Write-Info "Docker found: $dockerVersion"
    
    # Check if Docker is running
    try {
        docker ps | Out-Null
        Write-Info "Docker daemon is running"
    } catch {
        Write-Error "Docker daemon is not running!"
        Write-Host "Please start Docker Desktop and try again."
        exit 1
    }
}

# Check if PBF file exists
function Test-PbfFile {
    Write-Info "Checking PBF file..."
    
    if (-not (Test-Path $PbfFile)) {
        Write-Error "PBF file not found: $PbfFile"
        Write-Host ""
        Write-Host "Download Java Island PBF:"
        Write-Host "  New-Item -ItemType Directory -Force -Path data"
        Write-Host "  cd data"
        Write-Host "  Invoke-WebRequest -Uri 'http://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf' -OutFile 'java-latest.osm.pbf'"
        exit 1
    }
    
    $fileSize = (Get-Item $PbfFile).Length
    $fileSizeMB = [math]::Round($fileSize / 1MB, 2)
    Write-Info "PBF file found: $PbfFile ($fileSizeMB MB)"
}

# Convert PBF to MBTiles
function Convert-PbfToMbtiles {
    Write-Header "Step 1: Convert PBF to MBTiles"
    
    if (Test-Path $MbtilesFile) {
        Write-Warning "MBTiles file already exists: $MbtilesFile"
        $regenerate = Read-Host "Regenerate? (y/N)"
        if ($regenerate -ne "y") {
            Write-Info "Skipping conversion"
            return
        }
        Remove-Item $MbtilesFile -Force
    }
    
    Write-Info "Converting PBF to MBTiles format..."
    Write-Info "This may take 10-30 minutes depending on file size..."
    Write-Host ""
    
    # Pull planetiler image (more reliable than tilemaker)
    Write-Info "Pulling planetiler Docker image..."
    docker pull ghcr.io/onthegomap/planetiler:latest
    
    # Get absolute path for Windows
    $currentPath = (Get-Location).Path
    $dataPath = Join-Path $currentPath "data"
    
    # Convert using planetiler
    Write-Info "Running conversion with planetiler..."
    docker run -it --rm `
        -v "${dataPath}:/data" `
        -e JAVA_TOOL_OPTIONS="-Xmx2g" `
        ghcr.io/onthegomap/planetiler:latest `
        --download `
        --area=indonesia `
        --bounds=105.0,-8.8,114.0,-5.9 `
        --output=/data/java.mbtiles `
        --osm-path=/data/java-latest.osm.pbf
    
    if ($LASTEXITCODE -eq 0) {
        $mbtilesSize = (Get-Item $MbtilesFile).Length
        $mbtilesSizeMB = [math]::Round($mbtilesSize / 1MB, 2)
        Write-Info "✅ MBTiles created successfully: $MbtilesFile ($mbtilesSizeMB MB)"
    } else {
        Write-Error "Failed to convert PBF to MBTiles"
        exit 1
    }
}

# Start tileserver
function Start-Tileserver {
    Write-Header "Step 2: Start Tile Server"
    
    # Stop existing container if running
    $existing = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq "osrm-tileserver" }
    if ($existing) {
        Write-Info "Stopping existing tileserver container..."
        docker stop osrm-tileserver | Out-Null
        docker rm osrm-tileserver | Out-Null
    }
    
    Write-Info "Starting tileserver-gl on port $TileserverPort..."
    
    # Get absolute path for Windows
    $currentPath = (Get-Location).Path
    $dataPath = Join-Path $currentPath "data"
    
    docker run -d `
        --name osrm-tileserver `
        -p "${TileserverPort}:8080" `
        -v "${dataPath}:/data:ro" `
        --restart unless-stopped `
        $DockerImage `
        --verbose `
        --mbtiles /data/java.mbtiles
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "✅ Tileserver started successfully"
        Write-Info "Container: osrm-tileserver"
        Write-Info "Port: $TileserverPort"
    } else {
        Write-Error "Failed to start tileserver"
        exit 1
    }
}

# Test tileserver
function Test-Tileserver {
    Write-Header "Step 3: Test Tile Server"
    
    Write-Info "Waiting for tileserver to be ready..."
    Start-Sleep -Seconds 5
    
    # Test health endpoint
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$TileserverPort/health" -UseBasicParsing -ErrorAction SilentlyContinue
        Write-Info "✅ Health check passed"
    } catch {
        Write-Warning "Health endpoint not available (this is normal for some versions)"
    }
    
    # Test tile endpoint
    Write-Info "Testing tile generation..."
    $testTile = "http://localhost:$TileserverPort/styles/basic-preview/12/3230/1830.png"
    
    try {
        $tempFile = "$env:TEMP\test-tile.png"
        Invoke-WebRequest -Uri $testTile -OutFile $tempFile -UseBasicParsing
        $tileSize = (Get-Item $tempFile).Length
        $tileSizeKB = [math]::Round($tileSize / 1KB, 2)
        Write-Info "✅ Tile generation successful (size: $tileSizeKB KB)"
        Remove-Item $tempFile -Force
    } catch {
        Write-Error "Failed to generate test tile"
        Write-Host "Check logs: docker logs osrm-tileserver"
        exit 1
    }
}

# Update .env configuration
function Update-EnvConfig {
    Write-Header "Step 4: Update Configuration"
    
    $envFile = ".env"
    
    if (-not (Test-Path $envFile)) {
        Write-Info "Creating .env from .env.example..."
        Copy-Item ".env.example" $envFile
    }
    
    Write-Info "Updating $envFile with tileserver settings..."
    
    # Read current content
    $content = Get-Content $envFile
    
    # Update or add TILE_SERVER_URL
    $tileServerUrl = "http://localhost:$TileserverPort/styles/basic-preview"
    if ($content -match "TILE_SERVER_URL=") {
        $content = $content -replace "TILE_SERVER_URL=.*", "TILE_SERVER_URL=$tileServerUrl"
    } else {
        $content += "TILE_SERVER_URL=$tileServerUrl"
    }
    
    # Save updated content
    $content | Set-Content $envFile
    
    Write-Info "Configuration updated successfully"
    Write-Host ""
    Write-Host "Updated settings in .env file:" -ForegroundColor Cyan
    Write-Host "  TILE_SERVER_URL=$tileServerUrl"
}

# Display summary
function Show-Summary {
    Write-Header "Setup Complete!"
    
    Write-Host ""
    Write-Host "Local Tile Server is Running" -ForegroundColor Green
    Write-Host ""
    Write-Host "Service Information:" -ForegroundColor Cyan
    Write-Host "  - Container: osrm-tileserver"
    Write-Host "  - Port: $TileserverPort"
    Write-Host "  - Status: docker ps | findstr osrm-tileserver"
    Write-Host "  - Logs: docker logs -f osrm-tileserver"
    Write-Host ""
    Write-Host "Tile Server URLs:" -ForegroundColor Cyan
    Write-Host "  - Viewer: http://localhost:$TileserverPort"
    Write-Host "  - Tiles: http://localhost:$TileserverPort/styles/basic-preview/{z}/{x}/{y}.png"
    Write-Host "  - Example: http://localhost:$TileserverPort/styles/basic-preview/12/3230/1830.png"
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Start OSRM tile service:"
    Write-Host "     npm start"
    Write-Host ""
    Write-Host "  2. Test tile endpoint:"
    Write-Host "     Invoke-WebRequest http://localhost:8080/tiles/12/3230/1830.png -OutFile test.png"
    Write-Host ""
    Write-Host "  3. View logs:"
    Write-Host "     docker logs -f osrm-tileserver"
    Write-Host ""
    Write-Host "Tips:" -ForegroundColor Yellow
    Write-Host "  - Tiles are generated on-demand from your PBF file"
    Write-Host "  - First request per tile will be slower (generating)"
    Write-Host "  - Subsequent requests are cached and fast"
    Write-Host "  - No need to download from tile.openstreetmap.org!"
    Write-Host ""
}

# Main execution
function Main {
    Write-Header "Local Tile Server Setup"
    Write-Host "This script will set up tileserver-gl to serve tiles from your PBF file"
    Write-Host ""
    
    Test-Docker
    Test-PbfFile
    
    Write-Host ""
    $confirm = Read-Host "Continue with setup? (y/N)"
    if ($confirm -ne "y") {
        Write-Info "Setup cancelled"
        exit 0
    }
    
    Convert-PbfToMbtiles
    Start-Tileserver
    Test-Tileserver
    Update-EnvConfig
    Show-Summary
}

# Run main function
Main
