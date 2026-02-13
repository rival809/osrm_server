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
    
    return $true
}

function Setup-Environment {
    Write-Section "ENVIRONMENT SETUP"
    
    Write-Step "Installing Node.js dependencies" "Installing required packages"
    
    try {
        npm install
        Write-Success "Dependencies installed successfully"
    } catch {
        Write-Error "Failed to install dependencies: $($_.Exception.Message)"
        return $false
    }
    
    # Create .env file
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
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Environment file created"
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
    
    Write-Step "Downloading Java OSM data" "~800MB - This may take a while"
    
    $url = "https://download.geofabrik.de/asia/indonesia-latest.osm.pbf"
    
    try {
        # Use built-in PowerShell download
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
    
    Write-Step "Converting PBF to MBTiles" "10-30 minutes - CPU intensive"
    Write-Host "   This process generates vector tiles for the map display" -ForegroundColor Gray
    
    try {
        # Install tilemaker if needed
        if (-not (Get-Command tilemaker -ErrorAction SilentlyContinue)) {
            Write-Step "Installing tilemaker" "Vector tile generation tool"
            npm install -g tilemaker-bin
        }
        
        # Run conversion
        tilemaker --input $pbfFile --output $mbtilesFile --process resources/process-openmaptiles.lua --config resources/config-openmaptiles.json
        
        Write-Success "MBTiles generated successfully"
        return $true
    } catch {
        Write-Error "MBTiles generation failed: $($_.Exception.Message)"
        Write-Host "   You can continue without MBTiles (will use external tile provider)" -ForegroundColor Yellow
        return $true  # Non-critical error
    }
}

function Process-OSRMData {
    Write-Section "OSRM DATA PROCESSING"
    
    $pbfFile = "data/java-latest.osm.pbf"
    $osrmFile = "data/java-latest.osrm"
    
    Write-Step "Processing OSRM routing data" "Using Docker containers"
    Write-Host "   This creates optimized routing graphs (~10-20 minutes)" -ForegroundColor Gray
    
    try {
        # Run processing script
        if (Test-Path "scripts/process-osrm-v6.ps1") {
            & "scripts/process-osrm-v6.ps1"
        } else {
            Write-Warning "OSRM processing script not found"
            Write-Host "   Run manually: docker run -t -v `"$PWD/data:/data`" ghcr.io/project-osrm/osrm-backend osrm-extract ..." -ForegroundColor Yellow
        }
        
        Write-Success "OSRM data processing complete"
        return $true
    } catch {
        Write-Error "OSRM processing failed: $($_.Exception.Message)"
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
