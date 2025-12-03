# Monitor download progress
# Run this to check current download status

while ($true) {
    if (Test-Path "data\java-latest.osm.pbf") {
        $file = Get-Item "data\java-latest.osm.pbf"
        $sizeMB = [math]::Round($file.Length / 1MB, 2)
        $percentage = [math]::Round(($sizeMB / 800) * 100, 1)
        
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - Downloaded: $sizeMB MB ($percentage%)" -ForegroundColor Green
        
        # Check if download is complete (assuming ~800MB total)
        if ($sizeMB -gt 700) {
            Write-Host "Download appears to be complete!" -ForegroundColor Cyan
            break
        }
        
        # Check if file is still being written (size changed in last 60 seconds)
        if ($file.LastWriteTime -lt (Get-Date).AddMinutes(-2)) {
            Write-Host "Warning: File hasn't been updated in 2+ minutes. Download may be stuck." -ForegroundColor Yellow
            $action = Read-Host "Continue monitoring? (y/n)"
            if ($action -notmatch '^[Yy]') {
                break
            }
        }
    } else {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - File not found" -ForegroundColor Red
    }
    
    Start-Sleep -Seconds 30
}

Write-Host "Monitoring stopped." -ForegroundColor Gray