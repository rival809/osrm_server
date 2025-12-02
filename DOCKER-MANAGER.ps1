# OSRM Docker Management Script
# Menjalankan OSRM Backend + Tile Cache Service dalam Docker

Write-Host "🐳 OSRM Docker Management" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Function to show menu
function Show-DockerMenu {
    Write-Host "Docker Services:" -ForegroundColor Yellow
    Write-Host "1. Start All Services (OSRM + Tile Cache)" -ForegroundColor White
    Write-Host "2. Stop All Services" -ForegroundColor White
    Write-Host "3. Restart Services" -ForegroundColor White
    Write-Host "4. View Logs (Tile Cache)" -ForegroundColor White
    Write-Host "5. View Logs (OSRM Backend)" -ForegroundColor White
    Write-Host "6. Service Status" -ForegroundColor White
    Write-Host "7. Build/Rebuild Images" -ForegroundColor White
    Write-Host "8. Clean Docker Cache" -ForegroundColor White
    Write-Host "9. Exit" -ForegroundColor White
    Write-Host ""
}

# Function to start services
function Start-DockerServices {
    Write-Host "🚀 Starting Docker services..." -ForegroundColor Green
    docker-compose up -d
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services started successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Services available at:" -ForegroundColor Cyan
        Write-Host "• OSRM Backend: http://localhost:5000" -ForegroundColor White
        Write-Host "• Tile Cache Service: http://localhost:3000" -ForegroundColor White
        Write-Host "• Cache Manager: Access via http://localhost:3000/cache/stats" -ForegroundColor White
        Write-Host ""
        
        # Wait for services to be ready
        Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
        Start-Sleep 10
        
        # Test connectivity
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5
            Write-Host "✅ Tile Cache Service is healthy" -ForegroundColor Green
        } catch {
            Write-Host "⚠️ Tile Cache Service may still be starting..." -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ Failed to start services" -ForegroundColor Red
    }
}

# Function to stop services
function Stop-DockerServices {
    Write-Host "🛑 Stopping Docker services..." -ForegroundColor Yellow
    docker-compose down
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services stopped successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to stop services" -ForegroundColor Red
    }
}

# Function to restart services
function Restart-DockerServices {
    Write-Host "🔄 Restarting Docker services..." -ForegroundColor Yellow
    docker-compose restart
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services restarted successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to restart services" -ForegroundColor Red
    }
}

# Function to show logs
function Show-TileCacheLogs {
    Write-Host "📋 Tile Cache Service Logs (Press Ctrl+C to exit)" -ForegroundColor Cyan
    docker-compose logs -f tile-cache
}

function Show-OSRMLogs {
    Write-Host "📋 OSRM Backend Logs (Press Ctrl+C to exit)" -ForegroundColor Cyan
    docker-compose logs -f osrm-backend
}

# Function to show status
function Show-ServiceStatus {
    Write-Host "📊 Service Status" -ForegroundColor Cyan
    Write-Host "=================" -ForegroundColor Cyan
    docker-compose ps
    Write-Host ""
    
    # Show resource usage
    Write-Host "💾 Resource Usage" -ForegroundColor Cyan
    Write-Host "=================" -ForegroundColor Cyan
    docker stats --no-stream osrm-backend osrm-tile-cache 2>$null
}

# Function to build images
function Build-DockerImages {
    Write-Host "🔨 Building Docker images..." -ForegroundColor Yellow
    docker-compose build --no-cache
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Images built successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to build images" -ForegroundColor Red
    }
}

# Function to clean Docker cache
function Clean-DockerCache {
    Write-Host "🧹 Cleaning Docker cache..." -ForegroundColor Yellow
    Write-Host "This will remove unused images, containers, and networks." -ForegroundColor Gray
    $confirm = Read-Host "Continue? (y/N)"
    
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        docker system prune -f
        docker image prune -f
        Write-Host "✅ Docker cache cleaned!" -ForegroundColor Green
    } else {
        Write-Host "❌ Cancelled" -ForegroundColor Yellow
    }
}

# Main loop
do {
    Show-DockerMenu
    $choice = Read-Host "Select option (1-9)"
    
    switch ($choice) {
        '1' { Start-DockerServices }
        '2' { Stop-DockerServices }
        '3' { Restart-DockerServices }
        '4' { Show-TileCacheLogs }
        '5' { Show-OSRMLogs }
        '6' { Show-ServiceStatus }
        '7' { Build-DockerImages }
        '8' { Clean-DockerCache }
        '9' { 
            Write-Host "👋 Goodbye!" -ForegroundColor Green
            exit 
        }
        default { 
            Write-Host "❌ Invalid option. Please select 1-9." -ForegroundColor Red 
        }
    }
    
    if ($choice -ne '9') {
        Write-Host ""
        Read-Host "Press Enter to continue"
        Clear-Host
    }
    
} while ($choice -ne '9')