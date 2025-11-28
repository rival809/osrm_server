#!/bin/bash

# Start OSRM services
# Script Bash untuk Linux/Ubuntu

set -e

echo "🚀 Starting OSRM Services..."
echo ""

# Check if OSRM data exists
if [ ! -f "data/java-latest.osrm" ]; then
    echo "❌ Error: OSRM data tidak ditemukan!"
    echo "   Jalankan: ./scripts/download-pbf.sh"
    echo "   Kemudian: ./scripts/process-osrm.sh"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker tidak berjalan!"
    echo "   Start Docker service: sudo systemctl start docker"
    exit 1
fi

# Start OSRM backend
echo "🐳 Starting OSRM backend..."
docker-compose up -d osrm-backend

# Wait for OSRM to be ready
echo "⏳ Waiting for OSRM backend..."
sleep 5

# Check if OSRM is running
if docker ps | grep -q osrm-backend; then
    echo "   ✅ OSRM backend running"
else
    echo "   ❌ OSRM backend failed to start"
    docker logs osrm-backend
    exit 1
fi

# Start Node.js server
echo ""
echo "🚀 Starting Node.js server..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start server
npm start &
SERVER_PID=$!

echo ""
echo "✅ Services started successfully!"
echo ""
echo "📊 Status:"
echo "   - OSRM Backend: http://localhost:5000"
echo "   - Tile Service: http://localhost:8080"
echo ""
echo "🌐 Open in browser: http://localhost:8080"
echo ""
echo "💡 Commands:"
echo "   - Stop services: docker-compose down"
echo "   - View logs: docker logs osrm-backend"
echo "   - Check health: curl http://localhost:8080/health"
