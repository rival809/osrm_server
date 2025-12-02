# ========================================================================
# OSRM Tile Cache Manager v2.0 - Enhanced with Resume Download Support
# ========================================================================
# 
# Features:
# ✅ Resume Download: Skip completed files, continue partial downloads
# ✅ Smart Caching: MD5-based file naming prevents duplicates
# ✅ Metadata Tracking: JSON metadata for each download with completion status
# ✅ Batch Processing: Concurrent downloads with retry logic
# ✅ Progress Monitoring: Real-time stats and progress tracking
# ✅ Error Recovery: Automatic retry with exponential backoff
# ✅ Cache Validation: Integrity checks and cleanup utilities
# 
# Interactive management tool untuk cache sistem dengan Resume Download Support

# Global cache directory
$Global:CacheDir = ".\cache"
$Global:MetadataDir = ".\cache\.metadata"

# Function to format bytes to human readable
function Format-Bytes {
    param([long]$Bytes)
    
    if ($Bytes -eq 0) { return "0 Bytes" }
    
    $units = @("Bytes", "KB", "MB", "GB", "TB")
    $i = [Math]::Floor([Math]::Log($Bytes) / [Math]::Log(1024))
    $size = [Math]::Round($Bytes / [Math]::Pow(1024, $i), 2)
    
    return "$size $($units[$i])"
}

# Initialize cache directories
function Initialize-CacheDirectories {
    if (-not (Test-Path $Global:CacheDir)) {
        New-Item -ItemType Directory -Force -Path $Global:CacheDir | Out-Null
    }
    if (-not (Test-Path $Global:MetadataDir)) {
        New-Item -ItemType Directory -Force -Path $Global:MetadataDir | Out-Null
    }
}

# Function to generate cache key from URL
function Get-CacheKey {
    param([string]$Url)
    $hash = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Url)
    $hashBytes = $hash.ComputeHash($bytes)
    $hashString = [System.Convert]::ToHexString($hashBytes).ToLower()
    return $hashString
}

# Function to get cache file path
function Get-CacheFilePath {
    param([string]$Url)
    $key = Get-CacheKey -Url $Url
    $subDir = $key.Substring(0, 2)
    $cacheSubDir = Join-Path $Global:CacheDir $subDir
    
    if (-not (Test-Path $cacheSubDir)) {
        New-Item -ItemType Directory -Force -Path $cacheSubDir | Out-Null
    }
    
    return Join-Path $cacheSubDir "$key.tile"
}

# Function to get metadata file path
function Get-MetadataPath {
    param([string]$Url)
    $key = Get-CacheKey -Url $Url
    return Join-Path $Global:MetadataDir "$key.json"
}

# Function to check if file is complete
function Test-FileComplete {
    param(
        [string]$Url,
        [int]$ExpectedSize = 0
    )
    
    $cacheFile = Get-CacheFilePath -Url $Url
    $metaFile = Get-MetadataPath -Url $Url
    
    if (-not (Test-Path $cacheFile) -or -not (Test-Path $metaFile)) {
        return $false
    }
    
    try {
        $metadata = Get-Content $metaFile | ConvertFrom-Json
        $fileInfo = Get-Item $cacheFile
        
        # Check if download was completed
        if (-not $metadata.completed) {
            return $false
        }
        
        # Check file size if expected size provided
        if ($ExpectedSize -gt 0 -and $fileInfo.Length -ne $ExpectedSize) {
            return $false
        }
        
        # Check if file size matches metadata
        if ($metadata.size -and $fileInfo.Length -ne $metadata.size) {
            return $false
        }
        
        return $true
    } catch {
        Write-Warning "Error checking file completeness: $($_.Exception.Message)"
        return $false
    }
}

# Function to download with resume support
function Invoke-ResumeDownload {
    param(
        [string]$Url,
        [int]$TimeoutSec = 30,
        [int]$MaxRetries = 3
    )
    
    Initialize-CacheDirectories
    
    $cacheFile = Get-CacheFilePath -Url $Url
    $metaFile = Get-MetadataPath -Url $Url
    
    # Check if file is already complete
    if (Test-FileComplete -Url $Url) {
        Write-Host "✅ File already complete, skipping: $(Split-Path $cacheFile -Leaf)" -ForegroundColor Green
        return $cacheFile
    }
    
    # Get current file size for resume
    $currentSize = 0
    if (Test-Path $cacheFile) {
        $currentSize = (Get-Item $cacheFile).Length
    }
    
    # Load existing metadata if available
    $metadata = @{}
    if (Test-Path $metaFile) {
        try {
            $metadata = Get-Content $metaFile | ConvertFrom-Json -AsHashtable
        } catch {
            Write-Warning "Error reading metadata: $($_.Exception.Message)"
            $metadata = @{}
        }
    }
    
    for ($retry = 0; $retry -le $MaxRetries; $retry++) {
        try {
            if ($retry -gt 0) {
                Write-Host "🔄 Retry $retry/$MaxRetries for: $(Split-Path $cacheFile -Leaf)" -ForegroundColor Yellow
                Start-Sleep -Seconds (2 * $retry) # Exponential backoff
            }
            
            # Prepare headers for resume
            $headers = @{}
            if ($currentSize -gt 0) {
                $headers["Range"] = "bytes=$currentSize-"
                Write-Host "📄 Resuming download from byte $currentSize" -ForegroundColor Cyan
            }
            
            # Download with resume support
            $response = Invoke-WebRequest -Uri $Url -Headers $headers -TimeoutSec $TimeoutSec -UseBasicParsing
            
            # Update metadata
            $metadata.url = $Url
            $metadata.startTime = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
            $metadata.completed = $false
            
            if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 206) {
                $isResume = ($response.StatusCode -eq 206)
                $contentLength = $response.Headers["Content-Length"]
                
                if ($contentLength) {
                    $totalSize = if ($isResume) { $currentSize + [int64]$contentLength } else { [int64]$contentLength }
                    $metadata.totalSize = $totalSize
                }
                
                # Write content to file (append if resuming)
                if ($isResume -and $currentSize -gt 0) {
                    Add-Content -Path $cacheFile -Value $response.Content -Encoding Byte
                    Write-Host "📄 Resumed download: $(Split-Path $cacheFile -Leaf) (+$([int64]$contentLength) bytes)" -ForegroundColor Green
                } else {
                    Set-Content -Path $cacheFile -Value $response.Content -Encoding Byte
                    Write-Host "📄 New download: $(Split-Path $cacheFile -Leaf) ($([int64]$contentLength) bytes)" -ForegroundColor Green
                }
                
                # Update metadata as completed
                $fileSize = (Get-Item $cacheFile).Length
                $metadata.size = $fileSize
                $metadata.completed = $true
                $metadata.endTime = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
                
                # Save metadata
                $metadata | ConvertTo-Json | Set-Content $metaFile
                
                Write-Host "✅ Download completed: $(Split-Path $cacheFile -Leaf)" -ForegroundColor Green
                return $cacheFile
                
            } elseif ($response.StatusCode -eq 416) {
                # Range not satisfiable - file might be already complete
                Write-Host "✅ File appears to be already complete" -ForegroundColor Green
                $metadata.completed = $true
                $metadata | ConvertTo-Json | Set-Content $metaFile
                return $cacheFile
                
            } else {
                throw "HTTP $($response.StatusCode): $($response.StatusDescription)"
            }
            
        } catch {
            $lastError = $_.Exception.Message
            Write-Warning "Download attempt $($retry + 1) failed: $lastError"
            
            if ($retry -eq $MaxRetries) {
                Write-Error "❌ Download failed after $MaxRetries retries: $lastError"
                return $null
            }
        }
    }
    
    return $null
}

# Function to batch download with resume
function Invoke-BatchResumeDownload {
    param(
        [string[]]$Urls,
        [int]$Concurrency = 3,
        [int]$TimeoutSec = 30,
        [int]$MaxRetries = 3
    )
    
    $results = @()
    $total = $Urls.Count
    $processed = 0
    
    Write-Host "🚀 Starting batch download of $total files with resume support..." -ForegroundColor Cyan
    Write-Host "Concurrency: $Concurrency, Timeout: $TimeoutSec seconds, Max Retries: $MaxRetries" -ForegroundColor Gray
    Write-Host ""
    
    # Process in batches
    for ($i = 0; $i -lt $Urls.Count; $i += $Concurrency) {
        $batch = $Urls[$i..([Math]::Min($i + $Concurrency - 1, $Urls.Count - 1))]
        
        $jobs = @()
        foreach ($url in $batch) {
            $job = Start-Job -ScriptBlock {
                param($Url, $TimeoutSec, $MaxRetries, $Functions)
                
                # Import functions into job context
                $Functions | ForEach-Object { Invoke-Expression $_ }
                
                try {
                    $result = Invoke-ResumeDownload -Url $Url -TimeoutSec $TimeoutSec -MaxRetries $MaxRetries
                    return @{ Url = $Url; Success = $true; File = $result }
                } catch {
                    return @{ Url = $Url; Success = $false; Error = $_.Exception.Message }
                }
            } -ArgumentList $url, $TimeoutSec, $MaxRetries, @(
                ${function:Get-CacheKey}.ToString(),
                ${function:Get-CacheFilePath}.ToString(),
                ${function:Get-MetadataPath}.ToString(),
                ${function:Test-FileComplete}.ToString(),
                ${function:Initialize-CacheDirectories}.ToString(),
                ${function:Invoke-ResumeDownload}.ToString()
            )
            $jobs += $job
        }
        
        # Wait for batch completion
        $jobs | Wait-Job | ForEach-Object {
            $result = Receive-Job $_
            $results += $result
            Remove-Job $_
            
            $processed++
            $progress = [Math]::Round(($processed / $total) * 100, 1)
            
            if ($result.Success) {
                Write-Host "[$progress%] ✅ $($result.Url)" -ForegroundColor Green
            } else {
                Write-Host "[$progress%] ❌ $($result.Url) - $($result.Error)" -ForegroundColor Red
            }
        }
    }
    
    $successful = ($results | Where-Object { $_.Success }).Count
    $failed = ($results | Where-Object { -not $_.Success }).Count
    
    Write-Host ""
    Write-Host "📊 Batch download completed:" -ForegroundColor Cyan
    Write-Host "✅ Successful: $successful" -ForegroundColor Green
    Write-Host "❌ Failed: $failed" -ForegroundColor Red
    
    return $results
}

# Check if server is running
function Test-ServerRunning {
    try {
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/health" -Method GET -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

# Function to get local cache statistics  
function Get-LocalCacheStats {
    Initialize-CacheDirectories
    
    Write-Host ""
    Write-Host "==== LOCAL CACHE STATISTICS ====" -ForegroundColor Cyan
    Write-Host "Cache Directory: $Global:CacheDir" -ForegroundColor Gray
    Write-Host "Metadata Directory: $Global:MetadataDir" -ForegroundColor Gray
    Write-Host ""
    
    # Count files and calculate sizes
    $totalFiles = 0
    $totalSize = 0
    $completedFiles = 0
    $incompleteFiles = 0
    $byZoomLevel = @{}
    
    if (Test-Path $Global:CacheDir) {
        Get-ChildItem -Path $Global:CacheDir -Recurse -File -Filter "*.tile" | ForEach-Object {
            $totalFiles++
            $totalSize += $_.Length
            
            # Check if file is complete
            $url = "dummy://example.com/$($_.Name)" # We'll use filename to determine completeness
            $metaFile = Join-Path $Global:MetadataDir "$($_.BaseName).json"
            
            $isComplete = $false
            if (Test-Path $metaFile) {
                try {
                    $metadata = Get-Content $metaFile | ConvertFrom-Json
                    if ($metadata.completed -eq $true) {
                        $completedFiles++
                        $isComplete = $true
                        
                        # Try to extract zoom level from URL if available
                        if ($metadata.url -match "/(\d+)/\d+/\d+\.png") {
                            $zoom = $matches[1]
                            if (-not $byZoomLevel.ContainsKey($zoom)) {
                                $byZoomLevel[$zoom] = 0
                            }
                            $byZoomLevel[$zoom]++
                        }
                    }
                } catch {
                    # Invalid metadata
                }
            }
            
            if (-not $isComplete) {
                $incompleteFiles++
            }
        }
    }
    
    $totalSizeFormatted = Format-Bytes -Bytes $totalSize
    
    Write-Host "📊 File Statistics:" -ForegroundColor White
    Write-Host "  Total Files: $totalFiles" -ForegroundColor White
    Write-Host "  ✅ Completed: $completedFiles" -ForegroundColor Green
    Write-Host "  ⏸️  Incomplete: $incompleteFiles" -ForegroundColor Yellow
    Write-Host "  💾 Total Size: $totalSizeFormatted" -ForegroundColor White
    Write-Host ""
    
    if ($byZoomLevel.Keys.Count -gt 0) {
        Write-Host "📈 Files by Zoom Level:" -ForegroundColor Yellow
        $byZoomLevel.Keys | Sort-Object { [int]$_ } | ForEach-Object {
            Write-Host "  Zoom $_`: $($byZoomLevel[$_]) tiles" -ForegroundColor White
        }
        Write-Host ""
    }
    
    # Show metadata stats
    $metadataFiles = 0
    if (Test-Path $Global:MetadataDir) {
        $metadataFiles = (Get-ChildItem -Path $Global:MetadataDir -Filter "*.json" | Measure-Object).Count
    }
    
    Write-Host "📋 Metadata Files: $metadataFiles" -ForegroundColor Gray
    Write-Host ""
}

# Function to get cache statistics (combines local and server stats)
function Get-CacheStats {
    # Show local cache stats first
    Get-LocalCacheStats
    
    # Try to get server stats if available
    try {
        Write-Host "==== SERVER CACHE STATISTICS ====" -ForegroundColor Cyan
        $response = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 10
        Write-Host "Server Total Tiles: $($response.totalFiles)" -ForegroundColor White
        Write-Host "Server Cache Size: $($response.totalSize)" -ForegroundColor White
        Write-Host "Server Cache Directory: $($response.cacheDir)" -ForegroundColor Gray
        Write-Host ""
        
        if ($response.byZoomLevel) {
            Write-Host "Server Files by Zoom Level:" -ForegroundColor Yellow
            $response.byZoomLevel.PSObject.Properties | Sort-Object Name | ForEach-Object {
                Write-Host "  Zoom $($_.Name): $($_.Value) tiles" -ForegroundColor White
            }
            Write-Host ""
        }
    } catch {
        Write-Host "Server cache stats not available (server may be offline)" -ForegroundColor Yellow
        Write-Host ""
    }
}

# Function to show menu
# Function to clean incomplete downloads
function Clear-IncompleteDownloads {
    Initialize-CacheDirectories
    
    Write-Host ""
    Write-Host "🧹 Clean Incomplete Downloads" -ForegroundColor Cyan
    Write-Host "=============================" -ForegroundColor Cyan
    Write-Host "This will remove partial downloads and corrupted metadata files." -ForegroundColor Yellow
    Write-Host ""
    
    $cleaned = @()
    $metadataFiles = @()
    
    # Find all metadata files
    if (Test-Path $Global:MetadataDir) {
        $metadataFiles = Get-ChildItem -Path $Global:MetadataDir -Filter "*.json"
    }
    
    Write-Host "🔍 Scanning $($metadataFiles.Count) metadata files..." -ForegroundColor Yellow
    
    foreach ($metaFile in $metadataFiles) {
        try {
            $metadata = Get-Content $metaFile.FullName | ConvertFrom-Json
            $cacheKey = $metaFile.BaseName
            
            # Find corresponding cache file
            $cacheFiles = Get-ChildItem -Path $Global:CacheDir -Recurse -Filter "$cacheKey.tile"
            
            $shouldClean = $false
            $reason = ""
            
            if (-not $metadata.completed) {
                $shouldClean = $true
                $reason = "Incomplete download"
            } elseif ($cacheFiles.Count -eq 0) {
                $shouldClean = $true
                $reason = "Missing cache file"
            } elseif ($cacheFiles.Count -gt 0) {
                $cacheFile = $cacheFiles[0]
                if ($metadata.size -and $cacheFile.Length -ne $metadata.size) {
                    $shouldClean = $true
                    $reason = "Size mismatch (expected: $($metadata.size), actual: $($cacheFile.Length))"
                }
            }
            
            if ($shouldClean) {
                $cleaned += @{
                    MetaFile = $metaFile.FullName
                    CacheFile = if ($cacheFiles.Count -gt 0) { $cacheFiles[0].FullName } else { $null }
                    Reason = $reason
                    Url = $metadata.url
                }
            }
            
        } catch {
            # Invalid metadata file
            $cleaned += @{
                MetaFile = $metaFile.FullName
                CacheFile = $null
                Reason = "Invalid metadata"
                Url = "Unknown"
            }
        }
    }
    
    if ($cleaned.Count -eq 0) {
        Write-Host "✅ No incomplete downloads found. All cached files appear to be complete." -ForegroundColor Green
        return
    }
    
    Write-Host ""
    Write-Host "🗑️ Found $($cleaned.Count) incomplete/corrupted downloads:" -ForegroundColor Yellow
    $cleaned | ForEach-Object {
        Write-Host "  • $($_.Reason)" -ForegroundColor Red
        if ($_.Url -ne "Unknown") {
            Write-Host "    URL: $($_.Url)" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "WARNING: This will delete incomplete files and their metadata!" -ForegroundColor Red
    $confirm = Read-Host "Proceed with cleanup? (y/N)"
    
    if ($confirm.ToLower() -ne "y") {
        Write-Host "Cleanup cancelled." -ForegroundColor Yellow
        return
    }
    
    Write-Host ""
    Write-Host "🧹 Cleaning incomplete downloads..." -ForegroundColor Cyan
    
    $deletedCount = 0
    foreach ($item in $cleaned) {
        try {
            # Remove metadata file
            if (Test-Path $item.MetaFile) {
                Remove-Item $item.MetaFile -Force
                Write-Host "  🗑️ Removed metadata: $(Split-Path $item.MetaFile -Leaf)" -ForegroundColor Gray
            }
            
            # Remove cache file if exists
            if ($item.CacheFile -and (Test-Path $item.CacheFile)) {
                Remove-Item $item.CacheFile -Force
                Write-Host "  🗑️ Removed cache file: $(Split-Path $item.CacheFile -Leaf)" -ForegroundColor Gray
            }
            
            $deletedCount++
        } catch {
            Write-Host "  ❌ Failed to remove: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "✅ Cleanup completed!" -ForegroundColor Green
    Write-Host "🗑️ Removed $deletedCount incomplete downloads" -ForegroundColor White
    Write-Host "💡 You can now re-run the download to retry these files" -ForegroundColor Yellow
    Write-Host ""
}

function Show-Menu {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "       TILE CACHE MANAGER v2.0        " -ForegroundColor Cyan  
    Write-Host "     with Resume Download Support      " -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Cache Statistics (Local + Server)" -ForegroundColor White
    Write-Host "2. Java Island Preload (Resume Support)" -ForegroundColor White
    Write-Host "3. Monitor Progress (Real-time)" -ForegroundColor White
    Write-Host "4. Clean Incomplete Downloads" -ForegroundColor White
    Write-Host "5. Manual Update Tiles" -ForegroundColor White
    Write-Host "6. Clean All Cache" -ForegroundColor White
    Write-Host "7. Start Server" -ForegroundColor White
    Write-Host "8. Exit" -ForegroundColor White
    Write-Host ""
    Write-Host "✨ New: Resume download skips completed files and continues partial downloads" -ForegroundColor Green
    Write-Host ""
}

# Function to generate tile URLs for given bounds and zoom levels
function Get-TileUrls {
    param(
        [double]$MinLat,
        [double]$MaxLat, 
        [double]$MinLng,
        [double]$MaxLng,
        [int[]]$ZoomLevels
    )
    
    $urls = @()
    $tileServer = "https://tile.openstreetmap.org"
    
    foreach ($zoom in $ZoomLevels) {
        # Calculate tile bounds for this zoom level
        $minX = [Math]::Floor(($MinLng + 180.0) / 360.0 * [Math]::Pow(2, $zoom))
        $maxX = [Math]::Floor(($MaxLng + 180.0) / 360.0 * [Math]::Pow(2, $zoom))
        
        $minY = [Math]::Floor((1.0 - [Math]::Log([Math]::Tan($MaxLat * [Math]::PI / 180.0) + 1.0 / [Math]::Cos($MaxLat * [Math]::PI / 180.0)) / [Math]::PI) / 2.0 * [Math]::Pow(2, $zoom))
        $maxY = [Math]::Floor((1.0 - [Math]::Log([Math]::Tan($MinLat * [Math]::PI / 180.0) + 1.0 / [Math]::Cos($MinLat * [Math]::PI / 180.0)) / [Math]::PI) / 2.0 * [Math]::Pow(2, $zoom))
        
        Write-Host "Zoom $zoom: tiles X($minX-$maxX) Y($minY-$maxY) = $(($maxX-$minX+1)*($maxY-$minY+1)) tiles" -ForegroundColor Gray
        
        for ($x = $minX; $x -le $maxX; $x++) {
            for ($y = $minY; $y -le $maxY; $y++) {
                $urls += "$tileServer/$zoom/$x/$y.png"
            }
        }
    }
    
    return $urls
}

# Function to start Java tile preloading with resume download
function Start-JavaTilePreload {
    Write-Host ""
    Write-Host "🗺️ Java Island Tile Preload with Resume Download" -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "Predefined bounds for Java island:" -ForegroundColor White
    Write-Host "• Area: Java Island (West to East)" -ForegroundColor Gray
    Write-Host "• Bounds: 105.0°E to 114.0°E, 8.8°S to 5.9°S" -ForegroundColor Gray
    Write-Host "• Coverage: ~180,000 km² (Java + Madura)" -ForegroundColor Gray
    Write-Host "• Method: Direct download from OSM servers with Resume Support" -ForegroundColor Green
    Write-Host "• Resume: Skips completed files, resumes partial downloads" -ForegroundColor Green
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
            $zoomLevels = @([int]$minZoom..[int]$maxZoom)
            Write-Host "Selected: Custom zoom $minZoom-$maxZoom" -ForegroundColor Green
        }
        default {
            Write-Host "Invalid option. Using standard preload (10-12)." -ForegroundColor Yellow
            $zoomLevels = @(10, 11, 12)
        }
    }
    
    # Java island bounds
    $minLat = -8.8
    $maxLat = -5.9
    $minLng = 105.0
    $maxLng = 114.0
    
    Write-Host ""
    Write-Host "🚀 Starting Java tile preload with resume support..." -ForegroundColor Cyan
    Write-Host "Zoom levels: $($zoomLevels -join ', ')" -ForegroundColor White
    Write-Host "Area: Java Island, Indonesia" -ForegroundColor White
    Write-Host ""
    
    # Generate tile URLs
    Write-Host "🔗 Generating tile URLs..." -ForegroundColor Yellow
    $allTileUrls = Get-TileUrls -MinLat $minLat -MaxLat $maxLat -MinLng $minLng -MaxLng $maxLng -ZoomLevels $zoomLevels
    
    Write-Host "📊 Generated $($allTileUrls.Count) tile URLs" -ForegroundColor White
    
    # Check which files are already complete
    Write-Host "🔍 Checking existing downloads..." -ForegroundColor Yellow
    $completedCount = 0
    $pendingUrls = @()
    
    foreach ($url in $allTileUrls) {
        if (Test-FileComplete -Url $url) {
            $completedCount++
        } else {
            $pendingUrls += $url
        }
    }
    
    Write-Host "✅ Already completed: $completedCount tiles" -ForegroundColor Green
    Write-Host "📥 Need to download: $($pendingUrls.Count) tiles" -ForegroundColor Cyan
    
    if ($pendingUrls.Count -eq 0) {
        Write-Host "🎉 All tiles already downloaded! Nothing to do." -ForegroundColor Green
        return
    }
    
    Write-Host "⚙️ Concurrency: 5 simultaneous downloads" -ForegroundColor Gray
    Write-Host "🔄 Retry policy: 3 attempts per tile with backoff" -ForegroundColor Gray
    Write-Host "📁 Cache location: $Global:CacheDir" -ForegroundColor Gray
    Write-Host ""
    
    $confirm = Read-Host "Continue with downloading $($pendingUrls.Count) remaining tiles? (y/N)"
    if ($confirm.ToLower() -ne "y") {
        Write-Host "Download cancelled." -ForegroundColor Yellow
        return
    }
    
    # Start batch download with resume (only pending URLs)
    $startTime = Get-Date
    try {
        $results = Invoke-BatchResumeDownload -Urls $pendingUrls -Concurrency 5 -TimeoutSec 30 -MaxRetries 3
        
        $endTime = Get-Date
        $duration = $endTime - $startTime
        
        $successful = ($results | Where-Object { $_.Success }).Count
        $failed = ($results | Where-Object { -not $_.Success }).Count
        
        Write-Host ""
        Write-Host "🎉 Java tile preload completed!" -ForegroundColor Green
        Write-Host "✅ New downloads: $successful" -ForegroundColor Green
        Write-Host "✅ Already had: $completedCount" -ForegroundColor Green
        Write-Host "✅ Total tiles: $($completedCount + $successful)" -ForegroundColor White
        Write-Host "❌ Failed downloads: $failed" -ForegroundColor Red
        Write-Host "⏱️ Download time: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor White
        Write-Host "📁 Files saved to: $Global:CacheDir" -ForegroundColor Gray
        Write-Host ""
        
        if ($failed -gt 0) {
            Write-Host "❗ Some downloads failed. You can re-run this command to retry failed downloads." -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "❌ Error during batch download: $($_.Exception.Message)" -ForegroundColor Red
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
    Write-Host "📊 Cache Progress Monitor (Direct OSM Downloads)" -ForegroundColor Cyan
    Write-Host "===============================================" -ForegroundColor Cyan
    Write-Host "Monitoring direct OSM tile downloads and cache storage..." -ForegroundColor White
    Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
    Write-Host ""
    
    # Test connectivity first
    Write-Host "🔍 Testing API connectivity..." -ForegroundColor Yellow
    try {
        $testResponse = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 5
        Write-Host "✅ API accessible" -ForegroundColor Green
        Write-Host "Raw API response sample:" -ForegroundColor Gray
        Write-Host ($testResponse | ConvertTo-Json -Depth 2) -ForegroundColor Gray
        Write-Host ""
        
        # Try different property names for count
        $initialCount = 0
        $initialSize = "Unknown"
        
        if ($testResponse.totalFiles -ne $null) {
            $initialCount = $testResponse.totalFiles
        } elseif ($testResponse.total -ne $null) {
            $initialCount = $testResponse.total
        } elseif ($testResponse.count -ne $null) {
            $initialCount = $testResponse.count
        }
        
        if ($testResponse.totalSize -ne $null) {
            $initialSize = $testResponse.totalSize
        } elseif ($testResponse.size -ne $null) {
            $initialSize = $testResponse.size
        }
        
        Write-Host "Initial: $initialCount tiles, $initialSize" -ForegroundColor Gray
        Write-Host "----------------------------------------" -ForegroundColor Gray
        
        while ($true) {
            try {
                $currentStats = Invoke-RestMethod -Uri "http://3.107.98.189:8080/cache/stats" -Method GET -TimeoutSec 5
                
                # Try different property names for current count
                $currentCount = 0
                $currentSize = "Unknown"
                
                if ($currentStats.totalFiles -ne $null) {
                    $currentCount = $currentStats.totalFiles
                } elseif ($currentStats.total -ne $null) {
                    $currentCount = $currentStats.total
                } elseif ($currentStats.count -ne $null) {
                    $currentCount = $currentStats.count
                }
                
                if ($currentStats.totalSize -ne $null) {
                    $currentSize = $currentStats.totalSize
                } elseif ($currentStats.size -ne $null) {
                    $currentSize = $currentStats.size
                }
                
                $timestamp = Get-Date -Format "HH:mm:ss"
                
                if ($currentCount -ge 0) {
                    $progress = $currentCount - $initialCount
                    Write-Host "$timestamp | Tiles: $currentCount (+$progress) | Size: $currentSize" -ForegroundColor White
                } else {
                    Write-Host "$timestamp | Raw response: $($currentStats | ConvertTo-Json -Compress)" -ForegroundColor Yellow
                }
                
                # Show breakdown by zoom level
                $zoomData = $null
                if ($currentStats.byZoomLevel) {
                    $zoomData = $currentStats.byZoomLevel
                } elseif ($currentStats.zoomLevels) {
                    $zoomData = $currentStats.zoomLevels
                }
                
                if ($zoomData) {
                    $zoomData.PSObject.Properties | Sort-Object Name | Select-Object -First 3 | ForEach-Object {
                        Write-Host "  Zoom $($_.Name): $($_.Value) tiles" -ForegroundColor Gray
                    }
                }
                Write-Host ""
                
            } catch {
                $timestamp = Get-Date -Format "HH:mm:ss"
                Write-Host "$timestamp | ❌ Unable to fetch stats: $($_.Exception.Message)" -ForegroundColor Red
            }
            
            Start-Sleep 3
        }
    } catch {
        Write-Host "❌ Cannot connect to http://3.107.98.189:8080" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please check if server is running and accessible" -ForegroundColor Yellow
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
            # Cache statistics - works offline too
            Get-CacheStats
        }
        "2" {
            # Java Island Preload with Resume - works offline (direct download from OSM)
            Start-JavaTilePreload
        }
        "3" {
            if (Test-ServerRunning) {
                Monitor-Progress
            } else {
                Write-Host "❌ Server tidak berjalan untuk monitoring server cache." -ForegroundColor Red
                Write-Host "💡 Tapi local cache statistics tetap tersedia di menu 1." -ForegroundColor Yellow
            }
        }
        "4" {
            # Clean incomplete downloads - works offline
            Clear-IncompleteDownloads
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
                Write-Host "❌ Server tidak berjalan untuk membersihkan server cache." -ForegroundColor Red
                Write-Host "💡 Gunakan menu 4 untuk membersihkan local cache yang tidak lengkap." -ForegroundColor Yellow
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