# Stop All Services
# Jalankan: .\STOP.ps1

Write-Host "🛑 Stopping OSRM Tile Service..." -ForegroundColor Yellow
Write-Host ""

# Stop Docker containers
Write-Host "🐳 Stopping Docker containers..." -ForegroundColor Cyan
docker-compose down

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Docker containers stopped" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to stop containers" -ForegroundColor Red
}

Write-Host ""
Write-Host "✅ All services stopped" -ForegroundColor Green
Write-Host "   To start again: .\START.ps1" -ForegroundColor Cyan
