# Script untuk memproses PBF file dengan OSRM (Windows PowerShell)
# File ini akan extract, partition, dan customize data untuk routing mobil

Write-Host "🔧 Memproses data OSM untuk OSRM..." -ForegroundColor Green
Write-Host "⚠️  Proses ini membutuhkan waktu 10-30 menit tergantung spesifikasi komputer" -ForegroundColor Yellow

$DATA_DIR = ".\data"
$PBF_FILE = "$DATA_DIR\java-latest.osm.pbf"

# Check if PBF file exists
if (-not (Test-Path $PBF_FILE)) {
    Write-Host "❌ File PBF tidak ditemukan: $PBF_FILE" -ForegroundColor Red
    Write-Host "📥 Jalankan: npm run download-pbf" -ForegroundColor Yellow
    exit 1
}

# Get absolute path
$ABSOLUTE_DATA_DIR = (Resolve-Path $DATA_DIR).Path

# Extract
Write-Host "📦 Step 1/3: Extract..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
if ($LASTEXITCODE -ne 0) { exit 1 }

# Partition
Write-Host "🗂️  Step 2/3: Partition..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" osrm/osrm-backend osrm-partition /data/java-latest.osrm
if ($LASTEXITCODE -ne 0) { exit 1 }

# Customize
Write-Host "⚙️  Step 3/3: Customize..." -ForegroundColor Cyan
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" osrm/osrm-backend osrm-customize /data/java-latest.osrm
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "✅ Proses selesai!" -ForegroundColor Green
Write-Host "🚀 OSRM data siap digunakan" -ForegroundColor Green
Write-Host ""
Write-Host "📌 Langkah selanjutnya:" -ForegroundColor Yellow
Write-Host "   1. Jalankan: npm run import-postgis"
Write-Host "   2. Jalankan: docker-compose up -d"
