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

# Install osm2pgsql if not exists
if ! command -v osm2pgsql &> /dev/null; then
    echo "📦 Installing osm2pgsql..."
    sudo apt update
    sudo apt install -y osm2pgsql
fi

# Import menggunakan osm2pgsql
echo "📥 Importing data dengan osm2pgsql..."
echo "    File: $DATA_FILE"
echo "    Target: $DB_HOST:$DB_PORT/$DB_NAME"
echo "    (Proses akan memakan waktu 30-60 menit...)"
echo ""

PGPASSWORD=$DB_PASS osm2pgsql \
    --create \
    --slim \
    --drop \
    --cache 4000 \
    --number-processes 2 \
    --hstore \
    --style /usr/share/osm2pgsql/default.style \
    --multi-geometry \
    --host $DB_HOST \
    --port $DB_PORT \
    --database $DB_NAME \
    --username $DB_USER \
    $DATA_FILE

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Import selesai!"
    echo "📊 Database statistics:"
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "\dt"
    echo ""
    echo "📌 Langkah selanjutnya:"
    echo "   1. Set TILE_MODE=render di environment"
    echo "   2. Restart Node.js server: npm start"
else
    echo ""
    echo "❌ Import gagal!"
    exit 1
fi
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
