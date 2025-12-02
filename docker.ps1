# Quick Docker Commands untuk OSRM Service
# Shortcut commands untuk management yang lebih mudah

param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    
    [Parameter(Position=1)]
    [string]$Service = "tile-cache"
)

Write-Host "🐳 OSRM Docker Quick Commands" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# Check if docker-compose is available
try {
    docker-compose --version | Out-Null
} catch {
    Write-Host "❌ docker-compose not found. Please install Docker and Docker Compose first." -ForegroundColor Red
    exit 1
}

switch ($Command.ToLower()) {
    { $_ -in @("start", "up") } {
        Write-Host "🚀 Starting OSRM services..." -ForegroundColor Green
        docker-compose up -d
        Write-Host ""
        Write-Host "Services are starting up. Check status with: .\docker.ps1 status" -ForegroundColor Yellow
        Write-Host "• Tile Cache: http://localhost:3000" -ForegroundColor White
        Write-Host "• OSRM Backend: http://localhost:5000" -ForegroundColor White
    }
    
    { $_ -in @("stop", "down") } {
        Write-Host "🛑 Stopping OSRM services..." -ForegroundColor Yellow
        docker-compose down
    }
    
    "restart" {
        Write-Host "🔄 Restarting OSRM services..." -ForegroundColor Yellow
        docker-compose restart
    }
    
    { $_ -in @("status", "ps") } {
        Write-Host "📊 Service Status:" -ForegroundColor Cyan
        docker-compose ps
        Write-Host ""
        Write-Host "💾 Resource Usage:" -ForegroundColor Cyan
        try {
            docker stats --no-stream osrm-backend osrm-tile-cache
        } catch {
            Write-Host "Services not running" -ForegroundColor Gray
        }
    }
    
    "logs" {
        Write-Host "📋 Showing logs for: $Service" -ForegroundColor Cyan
        Write-Host "Press Ctrl+C to exit" -ForegroundColor Yellow
        docker-compose logs -f $Service
    }
    
    "build" {
        Write-Host "🔨 Building Docker images..." -ForegroundColor Yellow
        docker-compose build --no-cache
    }
    
    "cache" {
        Write-Host "📊 Cache Statistics:" -ForegroundColor Cyan
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:3000/cache/stats" -TimeoutSec 5
            $response | ConvertTo-Json -Depth 3
        } catch {
            Write-Host "❌ Tile cache service not accessible. Is it running?" -ForegroundColor Red
        }
    }
    
    "preload" {
        Write-Host "🔄 Starting tile preload for Java island..." -ForegroundColor Green
        try {
            $testResponse = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5
            $preloadData = @{
                zoomLevels = @(10, 11, 12, 13)
            }
            $response = Invoke-RestMethod -Uri "http://localhost:3000/cache/preload" -Method POST -Body ($preloadData | ConvertTo-Json) -ContentType "application/json"
            $response | ConvertTo-Json -Depth 2
        } catch {
            Write-Host "❌ Tile cache service not accessible. Start services first with: .\docker.ps1 start" -ForegroundColor Red
        }
    }
    
    "clean" {
        Write-Host "🧹 Cleaning Docker resources..." -ForegroundColor Yellow
        Write-Host "This will remove stopped containers and unused images" -ForegroundColor Gray
        $confirm = Read-Host "Continue? (y/N)"
        if ($confirm -eq 'y' -or $confirm -eq 'Y') {
            docker system prune -f
            Write-Host "✅ Cleanup completed" -ForegroundColor Green
        }
    }
    
    "health" {
        Write-Host "🏥 Health Check:" -ForegroundColor Cyan
        Write-Host "Testing services..." -ForegroundColor White
        
        # Test tile cache
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5
            Write-Host "✅ Tile Cache Service: Healthy" -ForegroundColor Green
        } catch {
            Write-Host "❌ Tile Cache Service: Not accessible" -ForegroundColor Red
        }
        
        # Test OSRM
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:5000/health" -TimeoutSec 5
            Write-Host "✅ OSRM Backend: Healthy" -ForegroundColor Green
        } catch {
            Write-Host "❌ OSRM Backend: Not accessible" -ForegroundColor Red
        }
    }
    
    default {
        Write-Host "Usage: .\docker.ps1 [command] [service]" -ForegroundColor White
        Write-Host ""
        Write-Host "Available commands:" -ForegroundColor Yellow
        Write-Host "  start, up      - Start all services" -ForegroundColor White
        Write-Host "  stop, down     - Stop all services" -ForegroundColor White
        Write-Host "  restart        - Restart all services" -ForegroundColor White
        Write-Host "  status, ps     - Show service status" -ForegroundColor White
        Write-Host "  logs [service] - Show logs (default: tile-cache)" -ForegroundColor White
        Write-Host "  build          - Rebuild Docker images" -ForegroundColor White
        Write-Host "  cache          - Show cache statistics" -ForegroundColor White
        Write-Host "  preload        - Start tile preload" -ForegroundColor White
        Write-Host "  clean          - Clean Docker resources" -ForegroundColor White
        Write-Host "  health         - Check service health" -ForegroundColor White
        Write-Host "  help           - Show this help" -ForegroundColor White
        Write-Host ""
        Write-Host "Examples:" -ForegroundColor Cyan
        Write-Host "  .\docker.ps1 start       # Start all services" -ForegroundColor Gray
        Write-Host "  .\docker.ps1 logs        # Show tile-cache logs" -ForegroundColor Gray
        Write-Host "  .\docker.ps1 logs osrm-backend  # Show OSRM logs" -ForegroundColor Gray
        Write-Host "  .\docker.ps1 cache       # Show cache stats" -ForegroundColor Gray
    }
}