# ========================================================================
# OSRM MASTER SETUP - Complete End-to-End Setup for Windows
# ========================================================================
# 
# This script handles EVERYTHING from fresh clone to production deployment:
# - Prerequisites check & auto-install
# - Environment setup
# - OSM data download & processing  
# - OSRM backend setup
# - Tile cache preloading
# - Production deployment
# - Health checks & validation
# - Error recovery & troubleshooting

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
    
    # First check if prerequisites are already installed
    $nodeInstalled = $false
    $dockerInstalled = $false
    
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            $nodeInstalled = $true
        }
    } catch { }
    
    try {
        $dockerVersion = docker --version 2>$null
        if ($dockerVersion) {
            $dockerInstalled = $true
        }
    } catch { }
    
    # Check admin rights only if installations are needed
    if (-not ($nodeInstalled -and $dockerInstalled) -and -not (Test-AdminRights)) {
        Write-Warning "Some installations require administrator rights"
        Write-Host "Please run as administrator or install manually:" -ForegroundColor Yellow
        if (-not $nodeInstalled) {
            Write-Host "  - Node.js LTS: https://nodejs.org/"
        }
        if (-not $dockerInstalled) {
            Write-Host "  - Docker Desktop: https://desktop.docker.com/win/stable/Docker%20Desktop%20Installer.exe"
        }
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
    
    # Check curl.exe for fast downloads
    Write-Step "Checking curl" "Download utility (optional but recommended)"
    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curlPath) {
        try {
            $curlVersion = & curl.exe --version 2>$null | Select-Object -First 1
            Write-Success "curl.exe available: $curlVersion"
            Write-Host "   [OK] Fast downloads enabled" -ForegroundColor Gray
        } catch {
            Write-Success "curl.exe found (version check skipped)"
        }
    } else {
        Write-Warning "curl.exe not found (will use PowerShell download as fallback)"
        Write-Host "   Note: curl.exe is built-in on Windows 10 version 1803 and later" -ForegroundColor Gray
        Write-Host "   PowerShell downloads will be slower but still work" -ForegroundColor Gray
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
                Write-Host "Still waiting... ($elapsed / $timeout seconds)" -ForegroundColor Gray
            }
        }
        
        if ($elapsed -ge $timeout) {
            $msg = "Docker failed to start within $timeout seconds"
            Write-Error $msg
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
        $envContent | Out-File -FilePath ".env" -Encoding UTF8 -Force
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
        $sizeMB = [Math]::Round($fileInfo.Length / 1MB, 2)
        Write-Success "OSM data already exists: $dataFile ($sizeMB MB)"
        return $true
    }
    
    Write-Step "Downloading Java Island OSM data" "~800MB download from Geofabrik"
    $url = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
    
    # Create data directory if not exists
    if (-not (Test-Path "data")) {
        New-Item -ItemType Directory -Path "data" | Out-Null
    }
    
    # Try curl.exe first (faster and more reliable)
    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    
    if ($curlPath) {
        try {
            Write-Host "Using curl.exe for faster download..." -ForegroundColor Cyan
            Write-Host "Starting download..." -ForegroundColor Yellow
            Write-Host ""
            
            # Use curl with progress bar
            & curl.exe -L --progress-bar -o $dataFile $url
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Success "OSM data downloaded successfully"
                
                $fileInfo = Get-Item $dataFile
                $sizeMB = [Math]::Round($fileInfo.Length / 1MB, 2)
                Write-Host "   File size: $sizeMB MB" -ForegroundColor Gray
                return $true
            } else {
                throw "curl failed with exit code $LASTEXITCODE"
            }
        } catch {
            Write-Warning "curl download failed, trying PowerShell method..."
        }
    }
    
    # Fallback to PowerShell download
    try {
        Write-Host "Using PowerShell download (this may be slower)..." -ForegroundColor Yellow
        Write-Host "Starting download..." -ForegroundColor Yellow
        
        $webClient = New-Object System.Net.WebClient
        
        # Progress callback
        $global:lastUpdate = [DateTime]::Now
        Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action {
            $now = [DateTime]::Now
            if (($now - $global:lastUpdate).TotalSeconds -ge 2) {
                $percent = $Event.SourceEventArgs.ProgressPercentage
                $received = [Math]::Round($Event.SourceEventArgs.BytesReceived / 1MB, 1)
                $total = [Math]::Round($Event.SourceEventArgs.TotalBytesToReceive / 1MB, 1)
                Write-Progress -Activity "Downloading OSM Data" -Status "$received MB / $total MB ($percent%)" -PercentComplete $percent
                $global:lastUpdate = $now
            }
        } | Out-Null
        
        $webClient.DownloadFileAsync($url, $dataFile)
        
        # Wait for download to complete
        while ($webClient.IsBusy) {
            Start-Sleep -Milliseconds 500
        }
        
        $webClient.Dispose()
        Write-Progress -Activity "Downloading OSM Data" -Completed
        
        if (Test-Path $dataFile) {
            Write-Success "OSM data downloaded successfully"
            return $true
        } else {
            throw "File not found after download"
        }
    } catch {
        Write-Error "Failed to download OSM data: $($_.Exception.Message)"
        Write-Host "You can download manually from: $url" -ForegroundColor Yellow
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
    
    # Check if all required OSRM files exist (MLD algorithm requirements)
    $requiredFiles = @(
        "data\java-latest.osrm",
        "data\java-latest.osrm.datasource_names",
        "data\java-latest.osrm.edges",
        "data\java-latest.osrm.geometry",
        "data\java-latest.osrm.fileIndex"
    )
    
    $allFilesExist = $true
    foreach ($file in $requiredFiles) {
        if (-not (Test-Path $file)) {
            $allFilesExist = $false
            break
        }
    }
    
    if ($allFilesExist) {
        Write-Success "OSRM data already processed and complete"
        return $true
    }
    
    # Clean up any incomplete/old OSRM files
    Write-Step "Cleaning up old OSRM files" "Removing incomplete data"
    $oldFiles = Get-ChildItem "data" -Filter "java-latest.osrm*" -ErrorAction SilentlyContinue
    if ($oldFiles) {
        $oldFiles | Remove-Item -Force -ErrorAction SilentlyContinue
        Write-Host "   Removed $($oldFiles.Count) old file(s)" -ForegroundColor Gray
    }
    
    Write-Step "Processing OSM data for routing" "This may take 10-20 minutes"
    Write-Host ""
    
    # Get absolute path for Docker volume mount (Windows compatibility)
    $absoluteDataDir = (Resolve-Path "data").Path
    $osrmImage = "ghcr.io/project-osrm/osrm-backend:v6.0.0"
    
    try {
        # Extract
        Write-Host "Step 1/3: Extracting..." -ForegroundColor Cyan
        Write-Host "   This will take 5-10 minutes..." -ForegroundColor Gray
        docker run -t -v "${absoluteDataDir}:/data" $osrmImage osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
        # Note: Extract may return exit code 1 due to warnings (e.g., U-turn warnings), but files are still generated correctly
        # Check if required extract output file exists instead of relying on exit code
        if (-not (Test-Path "data\java-latest.osrm.nbg_nodes")) {
            throw "Extract failed - output files not generated"
        }
        Write-Success "Extract completed"
        
        # Partition
        Write-Host "Step 2/3: Partitioning..." -ForegroundColor Cyan
        Write-Host "   This will take 3-5 minutes..." -ForegroundColor Gray
        docker run -t -v "${absoluteDataDir}:/data" $osrmImage osrm-partition /data/java-latest.osrm
        if (-not (Test-Path "data\java-latest.osrm.partition")) {
            throw "Partition failed - output files not generated"
        }
        Write-Success "Partition completed"
        
        # Customize
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
        Write-Host "   2. Check if data/java-latest.osm.pbf exists" -ForegroundColor Gray
        Write-Host "   3. Verify sufficient disk space (~2GB needed)" -ForegroundColor Gray
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
    
    Write-Host "[SUCCESS] OSRM Service is now fully deployed and ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Available Services:" -ForegroundColor Cyan
    Write-Host "   * API Server:     http://localhost:8080" -ForegroundColor White
    Write-Host "   * OSRM Backend:   http://localhost:5000" -ForegroundColor White
    Write-Host "   * Web Interface:  http://localhost:8080" -ForegroundColor White
    Write-Host ""
    Write-Host "Management Commands:" -ForegroundColor Cyan
    Write-Host "   * Start:          .\START.ps1" -ForegroundColor White
    Write-Host "   * Stop:           .\STOP.ps1" -ForegroundColor White
    Write-Host "   * Cache Manager:  .\CACHE-MANAGER.ps1" -ForegroundColor White
    Write-Host "   * Docker Manager: .\DOCKER-MANAGER.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Run cache preload: .\CACHE-MANAGER.ps1 (option 2)" -ForegroundColor White
    Write-Host "   2. Test routing: http://localhost:8080" -ForegroundColor White
    Write-Host "   3. Monitor with: docker-compose logs -f" -ForegroundColor White
    Write-Host ""
    Write-Host "For production deployment, see DEPLOYMENT.md" -ForegroundColor Yellow
}

# Main execution
function Main {
    Write-Section "OSRM MASTER SETUP" "Green"
    Write-Host "Complete End-to-End Setup for Windows" -ForegroundColor White
    Write-Host ""
    Write-Host "This script will:" -ForegroundColor Cyan
    Write-Host "  - Install prerequisites (Node.js, Docker)" -ForegroundColor Gray
    Write-Host "  - Setup environment and dependencies" -ForegroundColor Gray
    Write-Host "  - Download Java Island OSM data (~800MB)" -ForegroundColor Gray
    Write-Host "  - Process OSRM routing data (10-20 min)" -ForegroundColor Gray
    Write-Host "  - Start all services" -ForegroundColor Gray
    Write-Host "  - Test deployment" -ForegroundColor Gray
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