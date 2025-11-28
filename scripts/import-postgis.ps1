# Script untuk import PBF ke PostGIS menggunakan osm2pgsql
# Untuk Windows PowerShell

Write-Host "🗄️  Importing OSM data ke PostgreSQL..." -ForegroundColor Green
Write-Host "⚠️  Proses ini membutuhkan waktu 20-60 menit" -ForegroundColor Yellow

$DATA_DIR = ".\data"
$PBF_FILE = "$DATA_DIR\java-latest.osm.pbf"

# Check if PBF file exists
if (-not (Test-Path $PBF_FILE)) {
    Write-Host "❌ File PBF tidak ditemukan: $PBF_FILE" -ForegroundColor Red
    Write-Host "📥 Jalankan: npm run download-pbf" -ForegroundColor Yellow
    exit 1
}

# Start PostgreSQL container jika belum jalan
Write-Host "🐘 Starting PostgreSQL container..." -ForegroundColor Cyan
docker-compose up -d postgis

# Tunggu PostgreSQL siap
Write-Host "⏳ Menunggu PostgreSQL siap..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Get absolute path
$ABSOLUTE_DATA_DIR = (Resolve-Path $DATA_DIR).Path

# Import menggunakan osm2pgsql
Write-Host "📥 Importing data dengan osm2pgsql..." -ForegroundColor Cyan
Write-Host "    (Ini akan memakan waktu lama, harap bersabar...)" -ForegroundColor Yellow

docker run --rm `
    --network osrm_service_osrm-network `
    -v "${ABSOLUTE_DATA_DIR}:/data" `
    iboates/osm2pgsql:latest `
    osm2pgsql `
    --create `
    --slim `
    --drop `
    --cache 2000 `
    --number-processes 4 `
    --hstore `
    --style /usr/share/osm2pgsql/default.style `
    --multi-geometry `
    --host postgis `
    --port 5432 `
    --database osm `
    --username osm `
    --password `
    /data/java-latest.osm.pbf

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Import selesai!" -ForegroundColor Green
    Write-Host "🗄️  Database siap digunakan" -ForegroundColor Green
    Write-Host ""
    Write-Host "📌 Langkah selanjutnya:" -ForegroundColor Yellow
    Write-Host "   Jalankan: docker-compose up -d"
} else {
    Write-Host "❌ Import gagal!" -ForegroundColor Red
    exit 1
}
