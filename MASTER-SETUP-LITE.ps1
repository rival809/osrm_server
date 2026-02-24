# ========================================================================
# OSRM MASTER SETUP - LITE VERSION (Without Nominatim Geocoding)
# ========================================================================
# 
# This LITE version skips Nominatim geocoding setup (saves ~130GB disk space!)
# Includes:
# - Prerequisites check & auto-install
# - Environment setup
# - OSM data download & processing  
# - OSRM backend setup (routing only)
# - Tile cache preloading
# - Uses docker-compose.lite.yml
# 
# Excludes:
# - Nominatim database import (saves 2-4 hours + 130GB)
# - PostgreSQL + PostGIS setup

param(
    [string]$Mode = "interactive",  # interactive, auto, production
    [string]$Region = "java",       # java, indonesia, custom
    [string]$Environment = "production"  # development, production
)

# Colors for better output
$ErrorActionPreference = "Continue"

function Write-Section {
    param([string]$Title, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor $Color
    Write-Host "  $Title" -ForegroundColor $Color
    Write-Host ("=" * 60) -ForegroundColor $Color
    Write-Host ""
}

function Write-Step {
    param([string]$Step, [string]$Description)
    Write-Host "[*] $Step" -ForegroundColor Yellow
    Write-Host "   $Description" -ForegroundColor Gray
}

function Write-Success {
    param([string]$Message)
    Write-Host "[+] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[-] $Message" -ForegroundColor Red
}

function Test-AdminRights {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-Chocolatey {
    Write-Step "Installing Chocolatey" "Package manager for Windows"
    
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Success "Chocolatey already installed"
        return $true
    }
    
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        
        # Refresh environment
        $env:PATH = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        Write-Success "Chocolatey installed successfully"
        return $true
    } catch {
        Write-Error "Failed to install Chocolatey: $($_.Exception.Message)"
        return $false
    }
}

function Install-Prerequisites {
    Write-Section "PREREQUISITES INSTALLATION"
    
    $nodeInstalled = $false
    
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            $nodeInstalled = $true
            Write-Success "Node.js already installed: $nodeVersion"
        }
    } catch { }
    
    if (-not $nodeInstalled) {
        if (-not (Test-AdminRights)) {
            Write-Warning "Node.js installation requires administrator rights"
            Write-Host "Please run as administrator or install Node.js manually from:" -ForegroundColor Yellow
            Write-Host "https://nodejs.org/" -ForegroundColor Cyan
            return $false
        }
        
        Write-Step "Installing Node.js" "Required for tile processing"
        
        if (-not (Install-Chocolatey)) {
            return $false
        }
        
        try {
            choco install nodejs -y
            $env:PATH = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Success "Node.js installed successfully"
        } catch {
            Write-Error "Failed to install Node.js: $($_.Exception.Message)"
            return $false
        }
    }
    
    # Verify npm
    try {
        $npmVersion = npm --version
        Write-Success "npm version: $npmVersion"
    } catch {
        Write-Error "npm not found"
        return $false
    }

    # Check Docker (required for MBTiles generation and OSRM processing)
    Write-Step "Checking Docker" "Required for MBTiles and OSRM processing"
    try {
        $dockerVersion = docker --version 2>$null
        if ($dockerVersion) {
            Write-Success "Docker installed: $dockerVersion"
        } else {
            throw "Docker not found"
        }
        # Verify Docker daemon is running
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }
        Write-Success "Docker daemon is running"
    } catch {
        Write-Error "Docker issue: $($_.Exception.Message)"
        Write-Host "   Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        Write-Host "   And make sure Docker is running before continuing." -ForegroundColor Yellow
        return $false
    }
    
    return $true
}

function Setup-Environment {
    Write-Section "ENVIRONMENT SETUP"

    # Create required directories
    Write-Step "Creating directories" "data, cache, logs"
    $directories = @("data", "cache", "cache\.metadata", "logs")
    foreach ($dir in $directories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            Write-Success "Created directory: $dir"
        }
    }
    
    Write-Step "Installing Node.js dependencies" "Installing required packages"
    
    try {
        npm install
        Write-Success "Dependencies installed successfully"
    } catch {
        Write-Error "Failed to install dependencies: $($_.Exception.Message)"
        return $false
    }
    
    # Create .env file (always overwrite to apply latest config)
    Write-Step "Creating environment configuration" "Setting up .env file"

    $envContent = @"
# OSRM Service Configuration (Lightweight Proxy Mode - LITE)
NODE_ENV=$Environment
PORT=81

# OSRM Backend (for routing)
OSRM_URL=http://localhost:5003

# Tileserver (for map tiles) - REQUIRED for self-hosted setup
TILE_SERVER_URL=http://localhost:5001/styles/basic-preview

# Memory Management
MAX_MEMORY_MB=10000

# Logging
LOG_LEVEL=info
"@
    try {
        $envContent | Out-File -FilePath ".env" -Encoding UTF8 -Force
        Write-Success ".env file written"
    } catch {
        Write-Error "Failed to create .env file: $($_.Exception.Message)"
        return $false
    }
    
    return $true
}

function Download-OSMData {
    Write-Section "OSM DATA DOWNLOAD"
    
    $pbfFile = "data/java-latest.osm.pbf"
    
    if (Test-Path $pbfFile) {
        $fileSize = (Get-Item $pbfFile).Length / 1MB
        Write-Warning "PBF file already exists ($([math]::Round($fileSize, 2)) MB)"
        $redownload = Read-Host "Re-download? (y/N)"
        if ($redownload.ToLower() -ne "y") {
            Write-Success "Using existing PBF file"
            return $true
        }
    }
    
    # Create data directory
    New-Item -ItemType Directory -Force -Path "data" | Out-Null
    
    Write-Step "Downloading Java Island OSM data" "~800MB - This may take a while"
    
    $url = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"

    # Try curl.exe first (faster, built-in on Windows 10+)
    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curlPath) {
        try {
            Write-Host "   Using curl.exe for download..." -ForegroundColor Cyan
            & curl.exe -L --progress-bar -o $pbfFile $url
            if ($LASTEXITCODE -eq 0) {
                $fileSize = (Get-Item $pbfFile).Length / 1MB
                Write-Success "Download complete ($([math]::Round($fileSize, 2)) MB)"
                return $true
            } else {
                throw "curl failed with exit code $LASTEXITCODE"
            }
        } catch {
            Write-Warning "curl download failed, falling back to PowerShell..."
        }
    }

    try {
        Write-Host "   Using PowerShell download..." -ForegroundColor Cyan
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $pbfFile -UseBasicParsing
        $ProgressPreference = 'Continue'
        
        $fileSize = (Get-Item $pbfFile).Length / 1MB
        Write-Success "Download complete ($([math]::Round($fileSize, 2)) MB)"
        return $true
    } catch {
        Write-Error "Download failed: $($_.Exception.Message)"
        return $false
    }
}

function Convert-PbfToMbtiles {
    Write-Section "MBTILES GENERATION"
    
    $pbfFile = "data/java-latest.osm.pbf"
    $mbtilesFile = "data/java.mbtiles"
    
    if (Test-Path $mbtilesFile) {
        Write-Warning "MBTiles file already exists"
        $reconvert = Read-Host "Re-generate? (y/N)"
        if ($reconvert.ToLower() -ne "y") {
            Write-Success "Using existing MBTiles file"
            return $true
        }
    }
    
    Write-Step "Converting PBF to MBTiles using planetiler" "10-30 minutes - CPU intensive"
    Write-Host "   This process generates vector tiles for the map display" -ForegroundColor Gray
    Write-Host ""

    # Pull planetiler Docker image
    Write-Host "   Pulling planetiler Docker image..." -ForegroundColor Cyan
    docker pull ghcr.io/onthegomap/planetiler:latest
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to pull planetiler image. Check your internet connection and Docker."
        return $false
    }

    # Get absolute path for Docker volume mount
    $currentPath = (Get-Location).Path
    $dataPath = Join-Path $currentPath "data"

    Write-Host "   Running planetiler conversion..." -ForegroundColor Cyan
    Write-Host "   This will take 10-30 minutes..." -ForegroundColor Gray

    docker run -it --rm `
        -v "${dataPath}:/data" `
        -e JAVA_TOOL_OPTIONS="-Xmx2g" `
        ghcr.io/onthegomap/planetiler:latest `
        --bounds=105.0,-8.8,114.0,-5.9 `
        --output=/data/java.mbtiles `
        --osm-path=/data/java-latest.osm.pbf `
        --force

    if ($LASTEXITCODE -ne 0) {
        Write-Error "MBTiles generation failed. Tileserver will not work without this file."
        return $false
    }

    if (Test-Path $mbtilesFile) {
        $fileSizeMB = [math]::Round((Get-Item $mbtilesFile).Length / 1MB, 2)
        Write-Success "MBTiles generated successfully: $mbtilesFile ($fileSizeMB MB)"
        return $true
    } else {
        Write-Error "MBTiles file was not created."
        return $false
    }
}

function Process-OSRMData {
    Write-Section "OSRM DATA PROCESSING"

    $pbfFile = "data\java-latest.osm.pbf"
    if (-not (Test-Path $pbfFile)) {
        Write-Error "OSM PBF file not found. Please download first."
        return $false
    }

    # Smart skip: check if all required OSRM files already exist
    $requiredFiles = @(
        "data\java-latest.osrm",
        "data\java-latest.osrm.cells",
        "data\java-latest.osrm.cell_metrics",
        "data\java-latest.osrm.cnbg",
        "data\java-latest.osrm.cnbg_to_ebg",
        "data\java-latest.osrm.datasource_names",
        "data\java-latest.osrm.ebg_nodes",
        "data\java-latest.osrm.edges",
        "data\java-latest.osrm.enw",
        "data\java-latest.osrm.fileIndex",
        "data\java-latest.osrm.geometry",
        "data\java-latest.osrm.icd",
        "data\java-latest.osrm.maneuver_overrides",
        "data\java-latest.osrm.mldgr",
        "data\java-latest.osrm.names",
        "data\java-latest.osrm.nbg_nodes",
        "data\java-latest.osrm.partition",
        "data\java-latest.osrm.properties",
        "data\java-latest.osrm.restrictions",
        "data\java-latest.osrm.timestamp",
        "data\java-latest.osrm.tld",
        "data\java-latest.osrm.tls",
        "data\java-latest.osrm.turn_duration_penalties",
        "data\java-latest.osrm.turn_penalties_index",
        "data\java-latest.osrm.turn_weight_penalties"
    )

    $foundCount = 0
    $allFilesExist = $true
    foreach ($file in $requiredFiles) {
        if (Test-Path $file) { $foundCount++ } else { $allFilesExist = $false }
    }

    if ($foundCount -ge 3) {
        if ($allFilesExist) {
            Write-Success "OSRM data already processed and complete ($foundCount of $($requiredFiles.Count) files found)"
        } else {
            Write-Warning "OSRM data partially processed: found $foundCount of $($requiredFiles.Count) files"
        }
        $reprocess = Read-Host "Do you want to reprocess OSRM data? (y/N)"
        if ($reprocess.ToLower() -ne "y") {
            Write-Success "Skipping OSRM processing, using existing data"
            return $true
        }
        Write-Warning "Reprocessing OSRM data..."
        $oldFiles = Get-ChildItem "data" -Filter "java-latest.osrm*" -ErrorAction SilentlyContinue
        if ($oldFiles) {
            $oldFiles | Remove-Item -Force -ErrorAction SilentlyContinue
            Write-Host "   Removed $($oldFiles.Count) old file(s)" -ForegroundColor Gray
        }
    }

    Write-Step "Processing OSM data for routing" "This may take 10-20 minutes"
    Write-Host ""

    $absoluteDataDir = (Resolve-Path "data").Path
    $osrmImage = "ghcr.io/project-osrm/osrm-backend:v6.0.0"

    try {
        # Step 1: Extract
        Write-Host "Step 1/3: Extracting..." -ForegroundColor Cyan
        Write-Host "   This will take 5-10 minutes..." -ForegroundColor Gray
        docker run -t -v "${absoluteDataDir}:/data" $osrmImage osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
        if (-not (Test-Path "data\java-latest.osrm.nbg_nodes")) {
            throw "Extract failed - output files not generated"
        }
        Write-Success "Extract completed"

        # Step 2: Partition
        Write-Host "Step 2/3: Partitioning..." -ForegroundColor Cyan
        Write-Host "   This will take 3-5 minutes..." -ForegroundColor Gray
        docker run -t -v "${absoluteDataDir}:/data" $osrmImage osrm-partition /data/java-latest.osrm
        if (-not (Test-Path "data\java-latest.osrm.partition")) {
            throw "Partition failed - output files not generated"
        }
        Write-Success "Partition completed"

        # Step 3: Customize
        Write-Host "Step 3/3: Customizing..." -ForegroundColor Cyan
        Write-Host "   This will take 2-5 minutes..." -ForegroundColor Gray
        docker run -t -v "${absoluteDataDir}:/data" $osrmImage osrm-customize /data/java-latest.osrm
        if (-not (Test-Path "data\java-latest.osrm.cells")) {
            throw "Customize failed - output files not generated"
        }
        Write-Success "Customize completed"

        Write-Host ""
        Write-Success "OSRM data processing completed successfully!"
        Write-Host "   All required files have been generated" -ForegroundColor Gray
        return $true
    } catch {
        Write-Error "OSRM processing failed: $($_.Exception.Message)"
        Write-Host ""
        Write-Host "Troubleshooting:" -ForegroundColor Yellow
        Write-Host "   1. Ensure Docker is running" -ForegroundColor Gray
        Write-Host "   2. Check if data/java-latest.osm.pbf exists and is not corrupt" -ForegroundColor Gray
        Write-Host "   3. Verify sufficient disk space (~2GB needed)" -ForegroundColor Gray
        return $false
    }
}

function Show-CompletionSummary {
    Write-Section "LITE SETUP COMPLETE" "Green"
    
    Write-Host "[SUCCESS] OSRM LITE setup completed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "What's Ready:" -ForegroundColor Cyan
    Write-Host "   [OK] Prerequisites installed" -ForegroundColor White
    Write-Host "   [OK] Environment configured (LITE mode)" -ForegroundColor White
    Write-Host "   [OK] OSM data downloaded (~800MB)" -ForegroundColor White
    Write-Host "   [OK] MBTiles generated for tileserver" -ForegroundColor White
    Write-Host "   [OK] OSRM routing data processed" -ForegroundColor White
    Write-Host "   [--] Nominatim geocoding SKIPPED (saves 130GB + 2-4 hours)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next Steps - Start Services (LITE):" -ForegroundColor Cyan
    Write-Host "   1. Build and start LITE containers:" -ForegroundColor White
    Write-Host "      docker compose -f docker-compose.lite.yml build --no-cache" -ForegroundColor Gray
    Write-Host "      docker compose -f docker-compose.lite.yml up -d" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   2. Check service status:" -ForegroundColor White
    Write-Host "      docker compose -f docker-compose.lite.yml ps" -ForegroundColor Gray
    Write-Host "      docker compose -f docker-compose.lite.yml logs -f" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Service Management (LITE):" -ForegroundColor Cyan
    Write-Host "   * Stop:           docker compose -f docker-compose.lite.yml down" -ForegroundColor White
    Write-Host "   * Restart:        docker compose -f docker-compose.lite.yml restart" -ForegroundColor White
    Write-Host "   * View logs:      docker compose -f docker-compose.lite.yml logs -f" -ForegroundColor White
    Write-Host ""
    Write-Host "Available Endpoints:" -ForegroundColor Cyan
    Write-Host "   * OSRM Tile Proxy:  http://localhost:81 (Routing + Tiles)" -ForegroundColor White
    Write-Host "   * OSRM Backend:     http://localhost:5003 (Direct API)" -ForegroundColor White
    Write-Host "   * Tileserver:       http://localhost:5001 (Map Tiles)" -ForegroundColor White
    Write-Host ""
    Write-Host "What's NOT included (LITE version):" -ForegroundColor Yellow
    Write-Host "   x Nominatim geocoding (address <-> coordinates)" -ForegroundColor Gray
    Write-Host "   x PostgreSQL database" -ForegroundColor Gray
    Write-Host ""
    Write-Host "[OK] LITE Version - Only ~10GB disk space!" -ForegroundColor Green
    Write-Host "[INFO] Need geocoding? Use docker-compose.yml (FULL version)" -ForegroundColor Cyan
}

# Main execution
function Main {
    Write-Section "OSRM MASTER SETUP - LITE VERSION" "Green"
    Write-Host "Fast Setup Without Geocoding (Saves 130GB + 2-4 hours)" -ForegroundColor White
    Write-Host ""
    Write-Host "This LITE script will:" -ForegroundColor Cyan
    Write-Host "  - Install prerequisites (Node.js)" -ForegroundColor Gray
    Write-Host "  - Setup environment and dependencies" -ForegroundColor Gray
    Write-Host "  - Download Java Island OSM data (~800MB)" -ForegroundColor Gray
    Write-Host "  - Convert PBF to MBTiles for tileserver (10-30 min)" -ForegroundColor Gray
    Write-Host "  - Process OSRM routing data (10-20 min)" -ForegroundColor Gray
    Write-Host "  - Prepare for Docker LITE deployment" -ForegroundColor Gray
    Write-Host ""
    Write-Host "SKIPPED (LITE mode):" -ForegroundColor Yellow
    Write-Host "  x Nominatim database import (saves 2-4 hours + 130GB)" -ForegroundColor DarkGray
    Write-Host "  x PostgreSQL + PostGIS setup" -ForegroundColor DarkGray
    Write-Host ""
    
    if ($Mode -eq "interactive") {
        $confirm = Read-Host "Continue with LITE setup? (Y/n)"
        if ($confirm.ToLower() -eq "n") {
            Write-Host "Setup cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
    
    # Execute setup steps
    if (-not (Install-Prerequisites)) {
        Write-Error "Prerequisites installation failed"
        exit 1
    }
    
    if (-not (Setup-Environment)) {
        Write-Error "Environment setup failed"
        exit 1
    }
    
    if (-not (Download-OSMData)) {
        Write-Error "OSM data download failed"
        exit 1
    }
    
    if (-not (Convert-PbfToMbtiles)) {
        Write-Error "MBTiles conversion failed"
        exit 1
    }
    
    if (-not (Process-OSRMData)) {
        Write-Error "OSRM data processing failed"
        exit 1
    }
    
    Show-CompletionSummary
}

# Run main function
Main
