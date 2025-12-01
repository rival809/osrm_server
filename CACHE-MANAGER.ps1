# OSRM Tile Cache Manager
# Interactive management tool untuk cache sistem

# Check if server is running
function Test-ServerRunning {
    try {
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/health" -Method GET -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

# Function to get cache statistics
function Get-CacheStats {
    try {
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 10
        Write-Host ""
        Write-Host "==== CACHE STATISTICS ====" -ForegroundColor Cyan
        Write-Host "Total Tiles: $($response.totalFiles)" -ForegroundColor White
        Write-Host "Cache Size: $($response.totalSize)" -ForegroundColor White
        Write-Host "Cache Directory: $($response.cacheDir)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Files by Zoom Level:" -ForegroundColor Yellow
        $response.byZoomLevel.PSObject.Properties | Sort-Object Name | ForEach-Object {
            Write-Host "  Zoom $($_.Name): $($_.Value) tiles" -ForegroundColor White
        }
        Write-Host ""
    } catch {
        Write-Host "Error getting cache stats: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Function to show menu
function Show-Menu {
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host "         TILE CACHE MANAGER          " -ForegroundColor Cyan  
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Cache Statistics" -ForegroundColor White
    Write-Host "2. Java Island Preload (Multiple Options)" -ForegroundColor White
    Write-Host "3. Monitor Progress (Real-time)" -ForegroundColor White
    Write-Host "4. Preload Tiles (Custom Zooms)" -ForegroundColor White
    Write-Host "5. Manual Update Tiles" -ForegroundColor White
    Write-Host "6. Clean All Cache" -ForegroundColor White
    Write-Host "7. Start Server" -ForegroundColor White
    Write-Host "8. Exit" -ForegroundColor White
    Write-Host ""
}

# Function to start Java tile preloading with options
function Start-JavaTilePreload {
    Write-Host ""
    Write-Host "🗺️ Java Island Tile Preload" -ForegroundColor Cyan
    Write-Host "============================" -ForegroundColor Cyan
    Write-Host "Predefined bounds for Java island:" -ForegroundColor White
    Write-Host "• Area: Java Island (West to East)" -ForegroundColor Gray
    Write-Host "• Bounds: 105.0°E to 114.0°E, 8.8°S to 5.9°S" -ForegroundColor Gray
    Write-Host "• Coverage: ~180,000 km² (Java + Madura)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Zoom level options:" -ForegroundColor Yellow
    Write-Host "1. Light (10-11) - ~2,500 tiles, ~95MB, ~5 min" -ForegroundColor White
    Write-Host "2. Standard (10-12) - ~13,800 tiles, ~520MB, ~15 min" -ForegroundColor White
    Write-Host "3. Detailed (10-13) - ~65,000 tiles, ~2.5GB, ~45 min" -ForegroundColor White
    Write-Host "4. High Detail (10-14) - ~350K tiles, ~13GB, ~3 hours" -ForegroundColor White
    Write-Host "5. Full Detail (10-15) - ~1.5M tiles, ~60GB, ~12 hours" -ForegroundColor White
    Write-Host "6. Custom zoom range" -ForegroundColor White
    Write-Host ""
    
    $option = Read-Host "Choose preload option (1-6)"
    
    switch ($option) {
        "1" { 
            $zoomLevels = @(10, 11)
            Write-Host "Selected: Light preload (zoom 10-11)" -ForegroundColor Green
        }
        "2" { 
            $zoomLevels = @(10, 11, 12)
            Write-Host "Selected: Standard preload (zoom 10-12)" -ForegroundColor Green
        }
        "3" { 
            $zoomLevels = @(10, 11, 12, 13)
            Write-Host "Selected: Detailed preload (zoom 10-13)" -ForegroundColor Green
        }
        "4" { 
            $zoomLevels = @(10, 11, 12, 13, 14)
            Write-Host "Selected: High Detail preload (zoom 10-14)" -ForegroundColor Green
        }
        "5" { 
            $zoomLevels = @(10, 11, 12, 13, 14, 15)
            Write-Host "Selected: Full Detail preload (zoom 10-15)" -ForegroundColor Green
        }
        "6" {
            $minZoom = Read-Host "Min Zoom Level (e.g., 10)"
            $maxZoom = Read-Host "Max Zoom Level (e.g., 13)"
            $zoomLevels = @($minZoom..$maxZoom)
            Write-Host "Selected: Custom zoom $minZoom-$maxZoom" -ForegroundColor Green
        }
        default {
            Write-Host "Invalid option. Using standard preload (10-12)." -ForegroundColor Yellow
            $zoomLevels = @(10, 11, 12)
        }
    }
    
    Write-Host ""
    Write-Host "🚀 Starting Java tile preload..." -ForegroundColor Cyan
    Write-Host "Zoom levels: $($zoomLevels -join ', ')" -ForegroundColor White
    Write-Host "Area: Java Island, Indonesia" -ForegroundColor White
    Write-Host ""
    
    $body = @{
        bounds = @{
            minLat = -8.8
            maxLat = -5.9
            minLng = 105.0
            maxLng = 114.0
        }
        zoomLevels = $ZoomLevels
    } | ConvertTo-Json -Depth 3

    try {
        Write-Host "Sending preload request..." -ForegroundColor Yellow
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/preload" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 300
        
        Write-Host ""
        Write-Host "Preload completed!" -ForegroundColor Green
        Write-Host "Total tiles processed: $($response.processed)" -ForegroundColor White
        Write-Host "New tiles cached: $($response.cached)" -ForegroundColor White
        Write-Host "Skipped (already cached): $($response.skipped)" -ForegroundColor White
        Write-Host "Processing time: $($response.processingTime)" -ForegroundColor Gray
        Write-Host ""
    } catch {
        Write-Host "Error during preload: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Function to clean cache
function Clean-Cache {
    param(
        [string]$Type = "all"
    )
    
    Write-Host ""
    Write-Host "WARNING: This will delete all cached tiles!" -ForegroundColor Red
    Write-Host "Are you sure? (y/N): " -NoNewline -ForegroundColor Yellow
    $confirm = Read-Host
    
    if ($confirm.ToLower() -ne "y") {
        Write-Host "Cache cleaning cancelled." -ForegroundColor Yellow
        return
    }
    
    try {
        Write-Host ""
        Write-Host "Cleaning cache..." -ForegroundColor Cyan
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/clean" -Method POST -TimeoutSec 30
        
        Write-Host "Cache cleaned successfully!" -ForegroundColor Green
        Write-Host "Removed files: $($response.removedCount)" -ForegroundColor White
        Write-Host "Freed space: $($response.freedSpace)" -ForegroundColor White
        Write-Host ""
    } catch {
        Write-Host "Error cleaning cache: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Function to monitor progress
function Monitor-Progress {
    Write-Host ""
    Write-Host "📊 Cache Progress Monitor" -ForegroundColor Cyan
    Write-Host "========================" -ForegroundColor Cyan
    Write-Host "Monitoring cache statistics in real-time..." -ForegroundColor White
    Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
    Write-Host ""
    
    try {
        # Get initial stats
        $initialStats = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 5
        $initialCount = $initialStats.totalFiles
        $initialSize = $initialStats.totalSize
        
        Write-Host "Initial: $initialCount tiles, $initialSize" -ForegroundColor Gray
        Write-Host "----------------------------------------" -ForegroundColor Gray
        
        while ($true) {
            try {
                $currentStats = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 5
                $currentCount = $currentStats.totalFiles
                $currentSize = $currentStats.totalSize
                $progress = $currentCount - $initialCount
                
                $timestamp = Get-Date -Format "HH:mm:ss"
                Write-Host "$timestamp | Tiles: $currentCount (+$progress) | Size: $currentSize" -ForegroundColor White
                
                # Show breakdown by zoom level
                if ($currentStats.byZoomLevel) {
                    $currentStats.byZoomLevel.PSObject.Properties | Sort-Object Name | Select-Object -First 5 | ForEach-Object {
                        Write-Host "  Zoom $($_.Name): $($_.Value) tiles" -ForegroundColor Gray
                    }
                }
                Write-Host ""
            } catch {
                $timestamp = Get-Date -Format "HH:mm:ss"
                Write-Host "$timestamp | ❌ Unable to fetch stats" -ForegroundColor Red
            }
            
            Start-Sleep 3
        }
    } catch {
        Write-Host "Error starting progress monitor: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Function to update tiles manually
function Update-TilesManual {
    Write-Host ""
    Write-Host "MANUAL TILE UPDATE" -ForegroundColor Cyan
    Write-Host "==================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Masukkan koordinat bounding box:" -ForegroundColor Yellow
    Write-Host "Format: minLat,minLng,maxLat,maxLng" -ForegroundColor Gray
    Write-Host "Contoh: -8.8,105.0,-5.9,114.0" -ForegroundColor Gray
    Write-Host ""
    
    $boundsInput = Read-Host "Bounds"
    
    Write-Host ""
    Write-Host "Masukkan zoom levels:" -ForegroundColor Yellow
    Write-Host "Format: minZoom,maxZoom" -ForegroundColor Gray
    Write-Host "Contoh: 10,13" -ForegroundColor Gray
    Write-Host ""
    
    $zoomInput = Read-Host "Zoom Range"
    
    if ([string]::IsNullOrWhiteSpace($boundsInput) -or [string]::IsNullOrWhiteSpace($zoomInput)) {
        Write-Host "Input tidak boleh kosong!" -ForegroundColor Red
        return
    }
    
    try {
        $boundsArray = $boundsInput.Split(',') | ForEach-Object { $_.Trim() }
        $zoomArray = $zoomInput.Split(',') | ForEach-Object { $_.Trim() }
        
        if ($boundsArray.Count -ne 4 -or $zoomArray.Count -ne 2) {
            Write-Host "Format input salah!" -ForegroundColor Red
            return
        }
        
        $minLat = $boundsArray[0]
        $minLng = $boundsArray[1]  
        $maxLat = $boundsArray[2]
        $maxLng = $boundsArray[3]
        $minZoom = $zoomArray[0]
        $maxZoom = $zoomArray[1]
        
        $minLatNum = [double]$minLat
        $maxLatNum = [double]$maxLat
        $minLngNum = [double]$minLng
        $maxLngNum = [double]$maxLng
        $minZoomNum = [int]$minZoom
        $maxZoomNum = [int]$maxZoom
        
        if (($minZoomNum -lt 0) -or ($maxZoomNum -gt 18) -or ($minZoomNum -gt $maxZoomNum)) {
            Write-Host "Zoom levels harus antara 0-18 dan minZoom harus lebih kecil atau sama dengan maxZoom" -ForegroundColor Red
            return
        }
        
    } catch {
        Write-Host "Input tidak valid. Pastikan format koordinat dan zoom benar." -ForegroundColor Red
        return
    }
    
    Write-Host ""
    Write-Host "Starting manual tile update..." -ForegroundColor Cyan
    Write-Host "   Area: [$minLat, $minLng] to [$maxLat, $maxLng]" -ForegroundColor White
    Write-Host "   Zoom: $minZoom - $maxZoom" -ForegroundColor White
    Write-Host "   Note: Ini akan re-download tiles dari OSM" -ForegroundColor Yellow
    Write-Host ""
    
    $body = @{
        bounds = @{
            minLat = $minLatNum
            maxLat = $maxLatNum
            minLng = $minLngNum
            maxLng = $maxLngNum
        }
        zoomRange = "$minZoom-$maxZoom"
        forceUpdate = $true
    } | ConvertTo-Json -Depth 3

    try {
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/update" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 300
        
        if ($response.success) {
            Write-Host ""
            Write-Host "Manual update completed!" -ForegroundColor Green
            Write-Host "Area: [$($response.bounds.minLat), $($response.bounds.minLng)] to [$($response.bounds.maxLat), $($response.bounds.maxLng)]" -ForegroundColor White
            Write-Host "Zoom Range: $($response.zoomRange)" -ForegroundColor White
            Write-Host ""
            Write-Host "$($response.note)" -ForegroundColor Yellow
        } else {
            Write-Host "Error: $($response.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "Error during manual update: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Main loop
do {
    Write-Host ""

    # Cek status server
    if (Test-ServerRunning) {
        Write-Host \"Server Status: RUNNING (http://3.107.98.189:8080)\" -ForegroundColor Green
    } else {
        Write-Host "Server Status: NOT RUNNING" -ForegroundColor Red
    }

    Write-Host ""
    Show-Menu

    $choice = Read-Host "Masukkan pilihan (1-8)"

    switch ($choice) {
        "1" {
            if (Test-ServerRunning) {
                Get-CacheStats
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "2" {
            if (Test-ServerRunning) {
                Start-JavaTilePreload
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "3" {
            if (Test-ServerRunning) {
                Monitor-Progress
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "4" {
            if (Test-ServerRunning) {
                Write-Host "Masukkan zoom levels (contoh: 8,9,10,11): " -NoNewline -ForegroundColor Yellow
                $zoomInput = Read-Host
                try {
                    $zooms = $zoomInput.Split(',') | ForEach-Object { [int]$_.Trim() }
                    $validZooms = $zooms | Where-Object { $_ -ge 0 -and $_ -le 18 }
                    
                    if ($validZooms.Count -gt 0) {
                        Start-TilePreload -ZoomLevels $validZooms
                    } else {
                        Write-Host "Zoom levels harus antara 0-18" -ForegroundColor Red
                    }
                } catch {
                    Write-Host "Format tidak valid. Gunakan format: 8,9,10,11" -ForegroundColor Red
                }
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "5" {
            if (Test-ServerRunning) {
                Update-TilesManual
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "6" {
            if (Test-ServerRunning) {
                Clean-Cache -Type "all"
            } else {
                Write-Host "Server tidak berjalan. Jalankan server terlebih dahulu." -ForegroundColor Red
            }
        }
        "7" {
            if (-not (Test-ServerRunning)) {
                Write-Host "Starting server..." -ForegroundColor Cyan
                Write-Host "Tekan Ctrl+C untuk stop server" -ForegroundColor Yellow
                Write-Host ""
                npm start
            } else {
                Write-Host "Server sudah berjalan." -ForegroundColor Yellow
            }
        }
        "8" {
            Write-Host "Goodbye!" -ForegroundColor Green
            break
        }
        default {
            Write-Host "Pilihan tidak valid. Pilih 1-8." -ForegroundColor Red
        }
    }
    
    if ($choice -ne "8" -and $choice -ne "7") {
        Write-Host ""
        Write-Host "Tekan Enter untuk melanjutkan..." -ForegroundColor Gray
        Read-Host
    }
    
} while ($choice -ne "8")