#!/bin/bash

# Download PBF file untuk Pulau Jawa
# Script Bash untuk Linux/Ubuntu

echo "📥 Mengunduh data OSM untuk Pulau Jawa..."
echo "⚠️  File ini ~842MB, proses akan memakan waktu beberapa menit"
echo ""

URL="https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
OUTPUT="data/java-latest.osm.pbf"

# Ensure data directory exists
if [ ! -d "data" ]; then
    mkdir -p data
fi

# Remove old file if exists
if [ -f "$OUTPUT" ]; then
    echo "🗑️  Menghapus file lama..."
    rm -f "$OUTPUT"
fi

echo "🔗 Source: $URL"
echo "📁 Target: $OUTPUT"
echo ""

# Download dengan progress bar menggunakan wget
if command -v wget &> /dev/null; then
    wget --progress=bar:force -O "$OUTPUT" "$URL"
elif command -v curl &> /dev/null; then
    curl -L --progress-bar -o "$OUTPUT" "$URL"
else
    echo "❌ Error: wget atau curl tidak ditemukan!"
    echo "   Install dengan: sudo apt install wget"
    exit 1
fi

# Check if download successful
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Error saat download!"
    echo ""
    echo "💡 Alternatif: Download manual dari:"
    echo "   https://download.geofabrik.de/asia/indonesia.html"
    echo "   Pilih Java dan simpan ke: $OUTPUT"
    exit 1
fi

# Check file size
if [ ! -f "$OUTPUT" ]; then
    echo "❌ Download gagal! File tidak ditemukan."
    exit 1
fi

FILE_SIZE=$(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT" 2>/dev/null)
SIZE_MB=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)

if [ "$FILE_SIZE" -lt 1048576 ]; then
    echo "❌ Download gagal! File terlalu kecil."
    echo "   Kemungkinan URL tidak valid atau file error"
    exit 1
fi

echo ""
echo "✅ Download selesai!"
echo "📁 File: $OUTPUT"
echo "📊 Size: ${SIZE_MB} MB"
echo ""
echo "📌 Langkah selanjutnya:"
echo "   1. Jalankan: ./scripts/process-osrm.sh"
echo "   2. Jalankan: docker-compose up -d"
echo "   3. Jalankan: npm start"
