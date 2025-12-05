#!/bin/bash

# Script untuk memproses PBF file dengan OSRM v6.0.0
# Menggunakan image yang sama dengan docker-compose

echo "Processing OSM data for OSRM v6.0.0..."
echo "This process requires 10-30 minutes depending on computer specs"

DATA_DIR="./data"
PBF_FILE="$DATA_DIR/java-latest.osm.pbf"

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "PBF file not found: $PBF_FILE"
    echo "Run: ./scripts/download-pbf.sh"
    exit 1
fi

# Get absolute path
ABSOLUTE_DATA_DIR=$(realpath $DATA_DIR)

# Use the same image as docker-compose
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v6.0.0"

# Extract
echo "Step 1/3: Extract..."
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf
if [ $? -ne 0 ]; then
    echo "Extract failed"
    exit 1
fi

# Partition
echo "Step 2/3: Partition..."
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-partition /data/java-latest.osrm
if [ $? -ne 0 ]; then
    echo "Partition failed"
    exit 1
fi

# Customize
echo "Step 3/3: Customize..."
docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE osrm-customize /data/java-latest.osrm
if [ $? -ne 0 ]; then
    echo "Customize failed"
    exit 1
fi

echo "OSRM processing completed successfully!"

# Clear tile cache since OSRM data has been rebuilt
echo ""
echo "🧹 Clearing tile cache (OSRM data has been rebuilt)..."
if [ -d "./cache/tiles" ]; then
    rm -rf ./cache/tiles/*
    echo "✅ Tile cache cleared"
else
    echo "⚠️  Cache directory not found (skip)"
fi

echo ""
echo "Files created:"
echo "- java-latest.osrm"
echo "- java-latest.osrm.hsgr"
echo "- java-latest.osrm.ch"