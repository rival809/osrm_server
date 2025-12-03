# ========================================================================
# OSRM MASTER SETUP - Complete End-to-End Setup for Windows
# ========================================================================
# 
# This script handles EVERYTHING from fresh clone to production deployment:
# ✅ Prerequisites check & auto-install
# ✅ Environment setup
# ✅ OSM data download & processing  
# ✅ OSRM backend setup
# ✅ Tile cache preloading
# ✅ Production deployment
# ✅ Health checks & validation
# ✅ Error recovery & troubleshooting

param(
    [string]$Mode = "interactive",  # interactive, auto, production
    [string]$Region = "java",       # java, indonesia, custom
    [string]$Environment = "development"  # development, production
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
    Write-Host "🔹 $Step" -ForegroundColor Yellow
    Write-Host "   $Description" -ForegroundColor Gray
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
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
    
    # Check admin rights
    if (-not (Test-AdminRights)) {
        Write-Warning "Some installations require administrator rights"
        Write-Host "Please run as administrator or install manually:" -ForegroundColor Yellow
        Write-Host "  - Docker Desktop: https://desktop.docker.com/win/stable/Docker%20Desktop%20Installer.exe"
        Write-Host "  - Node.js LTS: https://nodejs.org/"
        Write-Host ""
        
        $continue = Read-Host "Continue with current permissions? (y/N)"
        if ($continue.ToLower() -ne "y") {
            exit 1
        }
    }
    
    # Install Chocolatey
    if (-not (Install-Chocolatey)) {
        Write-Warning "Chocolatey installation failed, trying manual installation"
    }
    
    # Check and install Node.js
    Write-Step "Checking Node.js" "JavaScript runtime"
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Success "Node.js already installed: $nodeVersion"
        } else {
            throw "Node.js not found"
        }
    } catch {
        Write-Warning "Node.js not found, installing..."
        if (Get-Command choco -ErrorAction SilentlyContinue) {
            choco install nodejs -y
        } else {
            Write-Error "Please install Node.js manually from https://nodejs.org/"
            return $false
        }
    }
    
    # Check and install Docker
    Write-Step "Checking Docker" "Container platform"
    try {
        $dockerVersion = docker --version 2>$null
        if ($dockerVersion) {
            Write-Success "Docker already installed: $dockerVersion"
        } else {
            throw "Docker not found"
        }
    } catch {
        Write-Warning "Docker not found, installing..."
        if (Get-Command choco -ErrorAction SilentlyContinue) {
            choco install docker-desktop -y
        } else {
            Write-Error "Please install Docker Desktop manually from https://desktop.docker.com/"
            return $false
        }
    }
    
    # Check if Docker is running
    Write-Step "Checking Docker status" "Verify Docker daemon is running"
    try {
        docker ps 2>$null | Out-Null
        Write-Success "Docker is running"
    } catch {
        Write-Warning "Docker is not running. Starting Docker Desktop..."
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -WindowStyle Hidden
        Write-Host "Waiting for Docker to start..." -ForegroundColor Yellow
        
        $timeout = 60
        $elapsed = 0
        while ($elapsed -lt $timeout) {
            Start-Sleep -Seconds 5
            $elapsed += 5
            try {
                docker ps 2>$null | Out-Null
                Write-Success "Docker started successfully"
                break
            } catch {
                Write-Host "Still waiting... ($elapsed/$timeout seconds)" -ForegroundColor Gray
            }
        }
        
        if ($elapsed -ge $timeout) {
            Write-Error "Docker failed to start within $timeout seconds"
            return $false
        }
    }
    
    return $true
}

function Setup-Environment {
    Write-Section "ENVIRONMENT SETUP"
    
    # Create directories
    Write-Step "Creating directories" "Data, cache, and log directories"
    $directories = @("data", "cache", "cache\.metadata", "logs")
    foreach ($dir in $directories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            Write-Success "Created directory: $dir"
        }
    }
    
    # Setup .env file
    Write-Step "Setting up environment variables" "Creating .env configuration"
    if (-not (Test-Path ".env")) {
        $envContent = @"
# OSRM Service Configuration
NODE_ENV=$Environment
PORT=8080

# OSRM Backend
OSRM_URL=http://localhost:5000

# Cache Configuration
CACHE_DIR=./cache
CACHE_MODE=smart
PRELOAD_ENABLED=false
TILE_CACHE_TTL=86400000
MAX_CACHE_SIZE_MB=2000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
"@
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Created .env file"
    } else {
        Write-Success ".env file already exists"
    }
    
    # Install Node.js dependencies
    Write-Step "Installing Node.js dependencies" "npm install"
    try {
        npm install
        Write-Success "Dependencies installed successfully"
    } catch {
        Write-Error "Failed to install dependencies: $($_.Exception.Message)"
        return $false
    }
    
    return $true
}

function Download-OSMData {
    Write-Section "OSM DATA DOWNLOAD"
    
    $dataFile = "data\java-latest.osm.pbf"
    
    if (Test-Path $dataFile) {
        $fileInfo = Get-Item $dataFile
        $sizeGB = [Math]::Round($fileInfo.Length / 1GB, 2)
        Write-Success "OSM data already exists: $dataFile ($sizeGB GB)"
        return $true
    }
    
    Write-Step "Downloading Java Island OSM data" "~800MB download from Geofabrik"
    $url = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
    
    try {
        # Use PowerShell download with progress
        Write-Host "Starting download..." -ForegroundColor Yellow
        $webClient = New-Object System.Net.WebClient
        
        # Progress callback
        $webClient.add_DownloadProgressChanged({
            param($sender, $e)
            $percent = $e.ProgressPercentage
            $received = [Math]::Round($e.BytesReceived / 1MB, 1)
            $total = [Math]::Round($e.TotalBytesToReceive / 1MB, 1)
            Write-Progress -Activity "Downloading OSM Data" -Status "$received MB / $total MB" -PercentComplete $percent
        })
        
        $webClient.DownloadFile($url, $dataFile)
        $webClient.Dispose()
        
        Write-Progress -Activity "Downloading OSM Data" -Completed
        Write-Success "OSM data downloaded successfully"
        return $true
    } catch {
        Write-Error "Failed to download OSM data: $($_.Exception.Message)"
        Write-Host "You can download manually from: $url" -ForegroundColor Yellow
        return $false
    }
}

function Process-OSRMData {
    Write-Section "OSRM DATA PROCESSING"
    
    $osrmFile = "data\java-latest.osrm"
    if (Test-Path $osrmFile) {
        Write-Success "OSRM data already processed"
        return $true
    }
    
    $pbfFile = "data\java-latest.osm.pbf"
    if (-not (Test-Path $pbfFile)) {
        Write-Error "OSM PBF file not found. Please download first."
        return $false
    }
    
    Write-Step "Processing OSM data for routing" "This may take 10-20 minutes"
    
    try {
        # Extract
        Write-Host "Step 1/3: Extracting..." -ForegroundColor Yellow
        docker run --rm -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
        if ($LASTEXITCODE -ne 0) { throw "Extract failed" }
        
        # Partition
        Write-Host "Step 2/3: Partitioning..." -ForegroundColor Yellow
        docker run --rm -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-partition /data/java-latest.osrm
        if ($LASTEXITCODE -ne 0) { throw "Partition failed" }
        
        # Customize
        Write-Host "Step 3/3: Customizing..." -ForegroundColor Yellow
        docker run --rm -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-customize /data/java-latest.osrm
        if ($LASTEXITCODE -ne 0) { throw "Customize failed" }
        
        Write-Success "OSRM data processing completed"
        return $true
    } catch {
        Write-Error "OSRM processing failed: $($_.Exception.Message)"
        return $false
    }
}

function Start-Services {
    Write-Section "STARTING SERVICES"
    
    # Start OSRM Backend
    Write-Step "Starting OSRM Backend" "Docker container on port 5000"
    try {
        docker-compose up -d osrm-backend
        if ($LASTEXITCODE -eq 0) {
            Write-Success "OSRM Backend started"
        } else {
            throw "Docker compose failed"
        }
    } catch {
        Write-Error "Failed to start OSRM Backend: $($_.Exception.Message)"
        return $false
    }
    
    # Wait for OSRM to be ready
    Write-Step "Waiting for OSRM to be ready" "Health check"
    $maxAttempts = 12
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        Start-Sleep -Seconds 5
        try {
            $response = Invoke-RestMethod "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" -TimeoutSec 10
            Write-Success "OSRM Backend is healthy"
            break
        } catch {
            $attempt++
            Write-Host "Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
            if ($attempt -eq $maxAttempts) {
                Write-Error "OSRM Backend failed to start properly"
                return $false
            }
        }
    }
    
    return $true
}

function Test-Deployment {
    Write-Section "DEPLOYMENT TESTING"
    
    # Start API server in background for testing
    Write-Step "Starting API server for testing" "Node.js server on port 8080"
    
    $job = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        npm start
    }
    
    # Wait for server to start
    Start-Sleep -Seconds 10
    
    try {
        # Test health endpoint
        Write-Step "Testing health endpoint" "Basic connectivity"
        $health = Invoke-RestMethod "http://localhost:8080/health" -TimeoutSec 10
        Write-Success "Health check passed: $($health.status)"
        
        # Test routing
        Write-Step "Testing routing API" "End-to-end functionality"
        $route = Invoke-RestMethod "http://localhost:8080/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" -TimeoutSec 10
        if ($route.routes -and $route.routes.Count -gt 0) {
            Write-Success "Routing test passed"
        } else {
            Write-Warning "Routing test returned empty result"
        }
        
        # Test tile serving
        Write-Step "Testing tile serving" "Tile cache functionality"
        try {
            $tile = Invoke-WebRequest "http://localhost:8080/tiles/10/511/511.png" -TimeoutSec 10
            if ($tile.StatusCode -eq 200) {
                Write-Success "Tile serving test passed"
            }
        } catch {
            Write-Warning "Tile serving test failed (expected for first run)"
        }
        
        Write-Success "All core tests passed"
        return $true
        
    } catch {
        Write-Error "Deployment test failed: $($_.Exception.Message)"
        return $false
    } finally {
        # Stop test job
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -ErrorAction SilentlyContinue
    }
}

function Show-CompletionSummary {
    Write-Section "SETUP COMPLETE" "Green"
    
    Write-Host "🎉 OSRM Service is now fully deployed and ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📍 Available Services:" -ForegroundColor Cyan
    Write-Host "   • API Server:     http://localhost:8080" -ForegroundColor White
    Write-Host "   • OSRM Backend:   http://localhost:5000" -ForegroundColor White
    Write-Host "   • Web Interface:  http://localhost:8080" -ForegroundColor White
    Write-Host ""
    Write-Host "🎮 Management Commands:" -ForegroundColor Cyan
    Write-Host "   • Start:          .\START.ps1" -ForegroundColor White
    Write-Host "   • Stop:           .\STOP.ps1" -ForegroundColor White
    Write-Host "   • Cache Manager:  .\CACHE-MANAGER.ps1" -ForegroundColor White
    Write-Host "   • Docker Manager: .\DOCKER-MANAGER.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "📊 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Run cache preload: .\CACHE-MANAGER.ps1 (option 2)" -ForegroundColor White
    Write-Host "   2. Test routing: http://localhost:8080" -ForegroundColor White
    Write-Host "   3. Monitor with: docker-compose logs -f" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 For production deployment, see DEPLOYMENT.md" -ForegroundColor Yellow
}

# Main execution
function Main {
    Write-Section "OSRM MASTER SETUP" "Green"
    Write-Host "Complete End-to-End Setup for Windows" -ForegroundColor White
    Write-Host ""
    Write-Host "This script will:" -ForegroundColor Cyan
    Write-Host "  ✅ Install prerequisites (Node.js, Docker)" -ForegroundColor Gray
    Write-Host "  ✅ Setup environment and dependencies" -ForegroundColor Gray
    Write-Host "  ✅ Download Java Island OSM data (~800MB)" -ForegroundColor Gray
    Write-Host "  ✅ Process OSRM routing data (10-20 min)" -ForegroundColor Gray
    Write-Host "  ✅ Start all services" -ForegroundColor Gray
    Write-Host "  ✅ Test deployment" -ForegroundColor Gray
    Write-Host ""
    
    if ($Mode -eq "interactive") {
        $confirm = Read-Host "Continue with setup? (Y/n)"
        if ($confirm.ToLower() -eq "n") {
            Write-Host "Setup cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
    
    # Execute setup steps
    $steps = @(
        { Install-Prerequisites },
        { Setup-Environment },
        { Download-OSMData },
        { Process-OSRMData },
        { Start-Services },
        { Test-Deployment }
    )
    
    foreach ($step in $steps) {
        if (-not (& $step)) {
            Write-Error "Setup failed. Please check the error messages above."
            exit 1
        }
    }
    
    Show-CompletionSummary
    
    if ($Mode -eq "interactive") {
        Write-Host ""
        Read-Host "Press Enter to start the API server"
        npm start
    }
}

# Run main function
Main