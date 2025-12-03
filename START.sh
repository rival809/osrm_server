#!/bin/bash

# Start OSRM Service script

echo "🚀 Starting OSRM Service..."
echo "=========================="

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    echo "   Please install Node.js from https://nodejs.org"
    exit 1
fi
echo "   ✅ Node.js: $(node --version)"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found"
    echo "   Please install Docker"
    exit 1
fi
echo "   ✅ Docker: $(docker --version)"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running"
    echo "   Please start Docker service"
    exit 1
fi
echo "   ✅ Docker is running"

# Check if data files exist
PBF_FILE="data/java-latest.osm.pbf"
if [ ! -f "$PBF_FILE" ]; then
    echo "❌ OSM data not found: $PBF_FILE"
    echo "   Run: ./scripts/download-pbf.sh"
    exit 1
fi

# Check essential OSRM MLD files
OSRM_FILES=(
    "data/java-latest.osrm.fileIndex"
    "data/java-latest.osrm.cells"
    "data/java-latest.osrm.partition"
    "data/java-latest.osrm.mldgr"
)
MISSING_FILES=()
for file in "${OSRM_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo "❌ OSRM processed files missing:"
    printf '   %s\n' "${MISSING_FILES[@]}"
    echo "   Run: ./MASTER-SETUP.sh"
    exit 1
fi

echo ""
echo "🎯 All prerequisites OK!"

# Start Docker containers
echo ""
echo "📦 Starting OSRM backend..."
docker-compose up -d osrm-backend

# Wait for OSRM to be ready
echo "⏳ Waiting for OSRM backend to be ready..."
sleep 10

# Test OSRM health
echo "🔍 Testing OSRM backend health..."
if curl -s -f "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null; then
    echo "✅ OSRM backend is healthy"
else
    echo "❌ OSRM backend health check failed"
    echo "📋 Container logs:"
    docker logs osrm-backend --tail 20
    exit 1
fi

# Start Node.js API server
echo ""
echo "🌐 Starting API server..."
echo ""
echo "📍 Available endpoints:"
echo "   http://localhost:3000/ - Web interface"
echo "   http://localhost:3000/route - Routing API"
echo "   http://localhost:3000/tiles/{z}/{x}/{y}.png - Tiles API"
echo "   http://localhost:3000/cache/stats - Cache statistics"
echo ""
echo "💡 To manage cache and preload tiles, run:"
echo "   ./CACHE-MANAGER.sh"
echo ""
echo "Press Ctrl+C to stop the server when done."
echo ""

# Start the server
npm start