#!/bin/bash

# Script untuk import PBF ke PostGIS menggunakan osm2pgsql

echo "🗄️  Importing OSM data ke PostgreSQL..."
echo "⚠️  Proses ini membutuhkan waktu 20-60 menit"

DATA_DIR="./data"
PBF_FILE="$DATA_DIR/java-latest.osm.pbf"

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ File PBF tidak ditemukan: $PBF_FILE"
    echo "📥 Jalankan: npm run download-pbf"
    exit 1
fi

# Start PostgreSQL container jika belum jalan
echo "🐘 Starting PostgreSQL container..."
docker-compose up -d postgis

# Tunggu PostgreSQL siap
echo "⏳ Menunggu PostgreSQL siap..."
sleep 10

# Import menggunakan osm2pgsql
echo "📥 Importing data dengan osm2pgsql..."
echo "    (Ini akan memakan waktu lama, harap bersabar...)"

docker run --rm \
    --network osrm_service_osrm-network \
    -v "${PWD}/data:/data" \
    iboates/osm2pgsql:latest \
    osm2pgsql \
    --create \
    --slim \
    --drop \
    --cache 2000 \
    --number-processes 4 \
    --hstore \
    --style /usr/share/osm2pgsql/default.style \
    --multi-geometry \
    --host postgis \
    --port 5432 \
    --database osm \
    --username osm \
    --password \
    /data/java-latest.osm.pbf

if [ $? -eq 0 ]; then
    echo "✅ Import selesai!"
    echo "🗄️  Database siap digunakan"
    echo ""
    echo "📌 Langkah selanjutnya:"
    echo "   Jalankan: docker-compose up -d"
else
    echo "❌ Import gagal!"
    exit 1
fi
