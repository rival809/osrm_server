# Fast download using curl.exe (Windows native curl)
# This is usually faster than PowerShell Invoke-WebRequest

Write-Host "Fast OSM Download for Java Island" -ForegroundColor Green
Write-Host "Using curl.exe for better performance" -ForegroundColor Cyan
Write-Host ""

$URL = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
$OUTPUT = "data\java-latest.osm.pbf"

# Ensure data directory exists
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# Ask user if they want to continue if file exists
if (Test-Path $OUTPUT) {
    $existingSize = [math]::Round((Get-Item $OUTPUT).Length / 1MB, 2)
    Write-Host "Existing file found: $existingSize MB" -ForegroundColor Yellow
    $continue = Read-Host "Delete and restart download? (y/N)"
    if ($continue -notmatch '^[Yy]') {
        Write-Host "Download cancelled." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item $OUTPUT -Force
}

Write-Host "Starting download with curl..." -ForegroundColor Green
Write-Host "URL: $URL" -ForegroundColor Gray
Write-Host "Output: $OUTPUT" -ForegroundColor Gray
Write-Host ""

# Use curl.exe with progress bar
try {
    & curl.exe -L --progress-bar -o $OUTPUT $URL
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Download completed successfully!" -ForegroundColor Green
        
        $fileInfo = Get-Item $OUTPUT
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        
        Write-Host "File: $OUTPUT" -ForegroundColor Green
        Write-Host "Size: $sizeMB MB" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "   1. Run: .\scripts\process-osrm-v6.ps1" -ForegroundColor White
        Write-Host "   2. Run: docker-compose up -d" -ForegroundColor White  
        Write-Host "   3. Run: npm start" -ForegroundColor White
    } else {
        throw "curl failed with exit code $LASTEXITCODE"
    }
    
} catch {
    Write-Host ""
    Write-Host "❌ Download failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "You can try:" -ForegroundColor Yellow
    Write-Host "   1. Run again: .\scripts\download-pbf-curl.ps1" -ForegroundColor White
    Write-Host "   2. Manual download from: https://download.geofabrik.de/asia/indonesia.html" -ForegroundColor White
    exit 1
}