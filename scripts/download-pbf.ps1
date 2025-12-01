# Download PBF file untuk Pulau Jawa
# Script PowerShell untuk Windows

Write-Host "Mengunduh data OSM untuk Pulau Jawa..." -ForegroundColor Green
Write-Host "File ini ~180MB, proses akan memakan waktu beberapa menit" -ForegroundColor Yellow
Write-Host ""

$URL = "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
$OUTPUT = "data\java-latest.osm.pbf"

# Ensure data directory exists
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# Remove old file if exists
if (Test-Path $OUTPUT) {
    Write-Host "Menghapus file lama..." -ForegroundColor Yellow
    Remove-Item $OUTPUT -Force
}

Write-Host "Source: $URL" -ForegroundColor Cyan
Write-Host "Target: $OUTPUT" -ForegroundColor Cyan
Write-Host ""

try {
    # Download dengan progress bar
    $ProgressPreference = 'Continue'
    Invoke-WebRequest -Uri $URL -OutFile $OUTPUT -UseBasicParsing
    
    # Check file size
    $fileInfo = Get-Item $OUTPUT
    $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
    
    if ($fileInfo.Length -lt 1MB) {
        Write-Host "Download gagal! File terlalu kecil." -ForegroundColor Red
        Write-Host "Kemungkinan URL tidak valid atau file error" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host ""
    Write-Host "Download selesai!" -ForegroundColor Green
    Write-Host "File: $OUTPUT" -ForegroundColor Green
    Write-Host "Size: $sizeMB MB" -ForegroundColor Green
    Write-Host ""
    Write-Host "Langkah selanjutnya:" -ForegroundColor Cyan
    Write-Host "   1. Jalankan: .\scripts\process-osrm-v6.ps1" -ForegroundColor White
    Write-Host "   2. Jalankan: docker-compose up -d" -ForegroundColor White
    Write-Host "   3. Jalankan: npm start" -ForegroundColor White
    
} catch {
    Write-Host ""
    Write-Host "Error saat download: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternatif: Download manual dari:" -ForegroundColor Yellow
    Write-Host "   https://download.geofabrik.de/asia/indonesia.html" -ForegroundColor Cyan
    Write-Host "   Pilih Java dan simpan ke: $OUTPUT" -ForegroundColor Cyan
    exit 1
}
