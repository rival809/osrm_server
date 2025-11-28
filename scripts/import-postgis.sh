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

# Check if PostgreSQL container exists
if ! docker ps -a | grep -q postgis; then
    echo "🐘 Starting PostgreSQL container..."
    docker-compose up -d postgis
else
    echo "🐘 PostgreSQL container already running"
fi

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec postgis pg_isready -h localhost -p 5432; do
    echo "   Waiting for PostgreSQL..."
    sleep 5
done
echo "   ✅ PostgreSQL ready!"

# Install required packages
echo "📦 Installing required packages..."
sudo apt update
if ! command -v psql &> /dev/null; then
    sudo apt install -y postgresql-client
fi
if ! command -v osm2pgsql &> /dev/null; then
    sudo apt install -y osm2pgsql
fi

# Import menggunakan osm2pgsql
echo "📥 Importing data dengan osm2pgsql..."
echo "    File: $PBF_FILE"
echo "    Target: localhost:5432/osm"
echo "    Cache: 4GB (adjust sesuai RAM tersedia)"
echo "    (Proses akan memakan waktu 30-60 menit...)"
echo ""

PGPASSWORD=osmpassword osm2pgsql \
    --create \
    --slim \
    --drop \
    --cache 4000 \
    --number-processes 2 \
    --hstore \
    --style /usr/share/osm2pgsql/default.style \
    --multi-geometry \
    --host localhost \
    --port 5432 \
    --database osm \
    --username osm \
    $PBF_FILE

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Import selesai!"
    echo "📊 Database statistics:"
    PGPASSWORD=osmpassword psql -h localhost -p 5432 -U osm -d osm -c "\dt"
    echo ""
    echo "🎯 Tables created:"
    PGPASSWORD=osmpassword psql -h localhost -p 5432 -U osm -d osm -c "SELECT schemaname,tablename,n_tup_ins FROM pg_stat_user_tables WHERE n_tup_ins > 0;"
    echo ""
    echo "📌 Langkah selanjutnya:"
    echo "   1. Server sudah set TILE_MODE=render"
    echo "   2. Restart Node.js server: npm start"
    echo "   3. Test tiles: curl http://localhost:8080/tiles/10/897/650.png"
else
    echo ""
    echo "❌ Import gagal!"
    echo "Check logs above untuk debugging"
    exit 1
fi
