#!/bin/bash

# Process OSRM data untuk Pulau Jawa
# Script Bash untuk Linux/Ubuntu

set -e

PBF_FILE="data/java-latest.osm.pbf"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend"

echo "🔄 Processing OSRM data untuk Pulau Jawa..."
echo ""

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ Error: File $PBF_FILE tidak ditemukan!"
    echo "   Jalankan: ./scripts/download-pbf.sh"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker tidak dapat diakses!"
    echo ""
    echo "💡 Kemungkinan penyebab:"
    echo "   1. Docker service belum running:"
    echo "      sudo systemctl start docker"
    echo ""
    echo "   2. User belum masuk group docker:"
    echo "      sudo usermod -aG docker $USER"
    echo "      newgrp docker"
    echo ""
    echo "   3. Atau jalankan dengan sudo:"
    echo "      sudo ./scripts/process-osrm.sh"
    exit 1
fi

echo "📦 File input: $PBF_FILE"
echo "🚗 Profile: car (mobil)"
echo ""

# Step 1: Extract
echo "1️⃣  Extract (5-10 menit)..."
docker run -t -v "${PWD}/data:/data" $OSRM_IMAGE \
    osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

if [ $? -ne 0 ]; then
    echo "❌ Extract gagal!"
    exit 1
fi
echo "   ✅ Extract selesai!"
echo ""

# Step 2: Partition
echo "2️⃣  Partition (3-5 menit)..."
docker run -t -v "${PWD}/data:/data" $OSRM_IMAGE \
    osrm-partition /data/java-latest.osrm

if [ $? -ne 0 ]; then
    echo "❌ Partition gagal!"
    exit 1
fi
echo "   ✅ Partition selesai!"
echo ""

# Step 3: Customize
echo "3️⃣  Customize (2-3 menit)..."
docker run -t -v "${PWD}/data:/data" $OSRM_IMAGE \
    osrm-customize /data/java-latest.osrm

if [ $? -ne 0 ]; then
    echo "❌ Customize gagal!"
    exit 1
fi
echo "   ✅ Customize selesai!"
echo ""

# List generated files
echo "📁 File yang dihasilkan:"
ls -lh data/*.osrm* 2>/dev/null || echo "   Tidak ada file .osrm*"
echo ""

echo "✅ Processing OSRM selesai!"
echo ""
echo "📌 Langkah selanjutnya:"
echo "   1. Jalankan: docker-compose up -d"
echo "   2. Jalankan: npm start"
echo "   3. Buka browser: http://localhost:8080"
