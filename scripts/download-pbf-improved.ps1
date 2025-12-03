# Improved PBF Download Script with Better Progress Tracking
# Download PBF file untuk Pulau Jawa dengan progress yang lebih baik

param(
    [switch]$Force = $false
)

Write-Host "Mengunduh data OSM untuk Pulau Jawa..." -ForegroundColor Green
Write-Host "File ini ~800MB, proses akan memakan waktu beberapa menit" -ForegroundColor Yellow
Write-Host ""

$URL = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
$OUTPUT = "data\java-latest.osm.pbf"
$TEMP_OUTPUT = "$OUTPUT.tmp"

# Ensure data directory exists
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# Check if file already exists and is complete
if ((Test-Path $OUTPUT) -and -not $Force) {
    $existingFile = Get-Item $OUTPUT
    $sizeMB = [math]::Round($existingFile.Length / 1MB, 2)
    
    if ($existingFile.Length -gt 100MB) {
        Write-Host "File sudah ada dan ukurannya $sizeMB MB" -ForegroundColor Yellow
        $continue = Read-Host "Lanjutkan download ulang? (y/N)"
        if ($continue -notmatch '^[Yy]') {
            Write-Host "Download dibatalkan." -ForegroundColor Yellow
            exit 0
        }
    }
}

Write-Host "Source: $URL" -ForegroundColor Cyan
Write-Host "Target: $OUTPUT" -ForegroundColor Cyan
Write-Host ""

# Custom download function with better progress
function Download-FileWithProgress {
    param(
        [string]$Url,
        [string]$OutputPath
    )
    
    try {
        # Get file size first
        Write-Host "Mengecek ukuran file..." -ForegroundColor Cyan
        $webRequest = [System.Net.HttpWebRequest]::Create($Url)
        $webRequest.Method = "HEAD"
        $webResponse = $webRequest.GetResponse()
        $totalSize = $webResponse.ContentLength
        $webResponse.Close()
        
        $totalSizeMB = [math]::Round($totalSize / 1MB, 2)
        Write-Host "Ukuran file: $totalSizeMB MB" -ForegroundColor Green
        Write-Host ""
        
        # Start download
        $webClient = New-Object System.Net.WebClient
        
        # Register progress event
        $global:downloadComplete = $false
        $global:startTime = Get-Date
        
        Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action {
            $received = $Event.SourceEventArgs.BytesReceived
            $total = $Event.SourceEventArgs.TotalBytesToReceive
            $percentage = [math]::Round(($received / $total) * 100, 1)
            $receivedMB = [math]::Round($received / 1MB, 2)
            $totalMB = [math]::Round($total / 1MB, 2)
            
            # Calculate speed
            $elapsed = ((Get-Date) - $global:startTime).TotalSeconds
            if ($elapsed -gt 0) {
                $speedMBps = [math]::Round($receivedMB / $elapsed, 2)
                $eta = if ($speedMBps -gt 0) {
                    $remainingMB = $totalMB - $receivedMB
                    [math]::Round($remainingMB / $speedMBps / 60, 1)
                } else { "Unknown" }
                
                Write-Progress -Activity "Downloading Java OSM Data" -Status "$percentage% Complete ($receivedMB/$totalMB MB) - Speed: $speedMBps MB/s - ETA: $eta min" -PercentComplete $percentage
            }
        } | Out-Null
        
        Register-ObjectEvent -InputObject $webClient -EventName DownloadFileCompleted -Action {
            $global:downloadComplete = $true
        } | Out-Null
        
        # Start async download
        Write-Host "Memulai download..." -ForegroundColor Green
        $webClient.DownloadFileAsync($Url, $OutputPath)
        
        # Wait for completion with timeout check
        $timeout = 1800 # 30 minutes timeout
        $elapsed = 0
        
        while (-not $global:downloadComplete -and $elapsed -lt $timeout) {
            Start-Sleep -Seconds 2
            $elapsed += 2
            
            # Check if file exists and show current size every 30 seconds
            if (($elapsed % 30 -eq 0) -and (Test-Path $OutputPath)) {
                $currentSize = (Get-Item $OutputPath).Length
                $currentSizeMB = [math]::Round($currentSize / 1MB, 2)
                Write-Host "Current progress: $currentSizeMB MB downloaded..." -ForegroundColor Gray
            }
        }
        
        if ($elapsed -ge $timeout) {
            throw "Download timeout after $($timeout/60) minutes"
        }
        
        $webClient.Dispose()
        Write-Progress -Activity "Downloading Java OSM Data" -Completed
        
        return $true
        
    } catch {
        Write-Host "Error during download: $($_.Exception.Message)" -ForegroundColor Red
        if (Test-Path $OutputPath) {
            Remove-Item $OutputPath -Force -ErrorAction SilentlyContinue
        }
        return $false
    }
}

# Remove old files
if (Test-Path $OUTPUT) {
    Write-Host "Menghapus file lama..." -ForegroundColor Yellow
    Remove-Item $OUTPUT -Force
}

if (Test-Path $TEMP_OUTPUT) {
    Remove-Item $TEMP_OUTPUT -Force
}

# Download the file
if (Download-FileWithProgress -Url $URL -OutputPath $OUTPUT) {
    # Verify download
    if (Test-Path $OUTPUT) {
        $fileInfo = Get-Item $OUTPUT
        $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        
        if ($fileInfo.Length -lt 10MB) {
            Write-Host "Download gagal! File terlalu kecil ($sizeMB MB)." -ForegroundColor Red
            Write-Host "Kemungkinan URL tidak valid atau koneksi bermasalah" -ForegroundColor Yellow
            Remove-Item $OUTPUT -Force
            exit 1
        }
        
        Write-Host ""
        Write-Host "✅ Download berhasil!" -ForegroundColor Green
        Write-Host "File: $OUTPUT" -ForegroundColor Green
        Write-Host "Size: $sizeMB MB" -ForegroundColor Green
        Write-Host ""
        Write-Host "Langkah selanjutnya:" -ForegroundColor Cyan
        Write-Host "   1. Jalankan: .\scripts\process-osrm-v6.ps1" -ForegroundColor White
        Write-Host "   2. Jalankan: docker-compose up -d" -ForegroundColor White
        Write-Host "   3. Jalankan: npm start" -ForegroundColor White
        
    } else {
        Write-Host "File tidak ditemukan setelah download!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "Download gagal!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternatif: Download manual dari:" -ForegroundColor Yellow
    Write-Host "   https://download.geofabrik.de/asia/indonesia.html" -ForegroundColor Cyan
    Write-Host "   Pilih Java dan simpan ke: $OUTPUT" -ForegroundColor Cyan
    exit 1
}