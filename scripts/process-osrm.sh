#!/bin/bash

# Script untuk memproses PBF file dengan OSRM
# File ini akan extract, partition, dan customize data untuk routing mobil

echo "🔧 Memproses data OSM untuk OSRM..."
echo "⚠️  Proses ini membutuhkan waktu 10-30 menit tergantung spesifikasi komputer"

DATA_DIR="./data"
PBF_FILE="$DATA_DIR/java-latest.osm.pbf"

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ File PBF tidak ditemukan: $PBF_FILE"
    echo "📥 Jalankan: npm run download-pbf"
    exit 1
fi

# Extract
echo "📦 Step 1/3: Extract..."
docker run -t -v "${PWD}/data:/data" osrm/osrm-backend osrm-extract \
    -p /opt/car.lua /data/java-latest.osm.pbf || exit 1

# Partition
echo "🗂️  Step 2/3: Partition..."
docker run -t -v "${PWD}/data:/data" osrm/osrm-backend osrm-partition \
    /data/java-latest.osrm || exit 1

# Customize
echo "⚙️  Step 3/3: Customize..."
docker run -t -v "${PWD}/data:/data" osrm/osrm-backend osrm-customize \
    /data/java-latest.osrm || exit 1

echo "✅ Proses selesai!"
echo "🚀 OSRM data siap digunakan"
echo ""
echo "📌 Langkah selanjutnya:"
echo "   1. Jalankan: npm run import-postgis"
echo "   2. Jalankan: docker-compose up -d"
