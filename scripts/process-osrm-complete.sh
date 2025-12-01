#!/bin/bash

# Complete OSRM processing script - extract, partition, customize dalam satu run

echo "🔧 Complete OSRM Data Processing"
echo "================================"
echo "This will run all OSRM processing steps:"
echo "1. Extract"
echo "2. Partition" 
echo "3. Customize"
echo ""

DATA_DIR="./data"
PBF_FILE="$DATA_DIR/java-latest.osm.pbf"

# Check if PBF file exists
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ PBF file not found: $PBF_FILE"
    echo "📥 Run: ./scripts/download-pbf.sh"
    exit 1
fi

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running"
    echo "   Please start Docker service"
    exit 1
fi

echo "⚠️  This process takes 15-45 minutes depending on your system"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "👋 Cancelled"
    exit 0
fi

# Get absolute path
ABSOLUTE_DATA_DIR=$(realpath $DATA_DIR)

# Use the same image as docker-compose
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v6.0.0"

echo "📦 Input file: $PBF_FILE"
echo "🐳 Docker image: $OSRM_IMAGE"
echo "🚗 Profile: car (driving)"
echo ""

# Step 1: Extract
echo "1️⃣  Extract (5-15 minutes)..."
START_TIME=$(date +%s)

docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE \
    osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

if [ $? -ne 0 ]; then
    echo "❌ Extract failed!"
    exit 1
fi

EXTRACT_TIME=$(($(date +%s) - START_TIME))
echo "   ✅ Extract completed in ${EXTRACT_TIME}s"
echo ""

# Step 2: Partition
echo "2️⃣  Partition (5-10 minutes)..."
START_TIME=$(date +%s)

docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE \
    osrm-partition /data/java-latest.osrm

if [ $? -ne 0 ]; then
    echo "❌ Partition failed!"
    exit 1
fi

PARTITION_TIME=$(($(date +%s) - START_TIME))
echo "   ✅ Partition completed in ${PARTITION_TIME}s"
echo ""

# Step 3: Customize
echo "3️⃣  Customize (3-8 minutes)..."
START_TIME=$(date +%s)

docker run -t -v "${ABSOLUTE_DATA_DIR}:/data" $OSRM_IMAGE \
    osrm-customize /data/java-latest.osrm

if [ $? -ne 0 ]; then
    echo "❌ Customize failed!"
    exit 1
fi

CUSTOMIZE_TIME=$(($(date +%s) - START_TIME))
echo "   ✅ Customize completed in ${CUSTOMIZE_TIME}s"
echo ""

# List generated files
echo "📁 Generated files:"
ls -lh data/*.osrm* 2>/dev/null || echo "   No .osrm* files found"
echo ""

TOTAL_TIME=$((EXTRACT_TIME + PARTITION_TIME + CUSTOMIZE_TIME))
echo "✅ Complete OSRM processing finished!"
echo "⏱️  Total time: ${TOTAL_TIME}s ($(($TOTAL_TIME/60))m $(($TOTAL_TIME%60))s)"
echo ""
echo "📌 Next steps:"
echo "   1. Start OSRM backend: docker-compose up -d osrm-backend"
echo "   2. Start API server: npm start"
echo "   3. Open browser: http://localhost:3000"