#!/bin/bash
# ============================================================
# Download GADM Administrative Boundaries untuk Indonesia
# Jalankan di server: bash scripts/download-boundaries.sh
# ============================================================

set -e

DEST_DIR="data/boundaries"
BASE_URL="https://geodata.ucdavis.edu/gadm/gadm4.1/json"

mkdir -p "$DEST_DIR"

echo "═══════════════════════════════════════════════════"
echo "  📥 Download GADM Indonesia Boundaries"
echo "═══════════════════════════════════════════════════"
echo ""
echo "📂 Folder tujuan: $DEST_DIR"
echo ""

# Level 1 - Provinsi (~15MB)
FILE1="gadm41_IDN_1.json"
if [ -f "$DEST_DIR/$FILE1" ]; then
    echo "✅ $FILE1 sudah ada, skip"
else
    echo "⏳ Downloading Level 1 (Provinsi)..."
    wget -q --show-progress -O "$DEST_DIR/${FILE1}.zip" "${BASE_URL}/${FILE1%.json}.json.zip" \
      || curl -L --progress-bar -o "$DEST_DIR/${FILE1}.zip" "${BASE_URL}/${FILE1%.json}.json.zip"
    echo "   📦 Extracting..."
    cd "$DEST_DIR" && unzip -o "${FILE1}.zip" && rm -f "${FILE1}.zip" && cd - > /dev/null
    echo "   ✅ $FILE1 done"
fi

# Level 2 - Kota/Kabupaten (~80MB)
FILE2="gadm41_IDN_2.json"
if [ -f "$DEST_DIR/$FILE2" ]; then
    echo "✅ $FILE2 sudah ada, skip"
else
    echo "⏳ Downloading Level 2 (Kota/Kabupaten)..."
    wget -q --show-progress -O "$DEST_DIR/${FILE2}.zip" "${BASE_URL}/${FILE2%.json}.json.zip" \
      || curl -L --progress-bar -o "$DEST_DIR/${FILE2}.zip" "${BASE_URL}/${FILE2%.json}.json.zip"
    echo "   📦 Extracting..."
    cd "$DEST_DIR" && unzip -o "${FILE2}.zip" && rm -f "${FILE2}.zip" && cd - > /dev/null
    echo "   ✅ $FILE2 done"
fi

# Level 3 - Kecamatan (~200MB)
FILE3="gadm41_IDN_3.json"
if [ -f "$DEST_DIR/$FILE3" ]; then
    echo "✅ $FILE3 sudah ada, skip"
else
    echo "⏳ Downloading Level 3 (Kecamatan)..."
    wget -q --show-progress -O "$DEST_DIR/${FILE3}.zip" "${BASE_URL}/${FILE3%.json}.json.zip" \
      || curl -L --progress-bar -o "$DEST_DIR/${FILE3}.zip" "${BASE_URL}/${FILE3%.json}.json.zip"
    echo "   📦 Extracting..."
    cd "$DEST_DIR" && unzip -o "${FILE3}.zip" && rm -f "${FILE3}.zip" && cd - > /dev/null
    echo "   ✅ $FILE3 done"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Download selesai!"
echo "═══════════════════════════════════════════════════"
echo ""
ls -lh "$DEST_DIR"/*.json 2>/dev/null || echo "⚠️  Tidak ada file .json ditemukan"
echo ""
echo "🚀 Selanjutnya jalankan:"
echo "   PGHOST=localhost node scripts/import-boundaries.js"
