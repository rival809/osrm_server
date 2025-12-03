#!/bin/bash
# Quick deployment script for production

set -e

echo "🚀 OSRM Production Deployment"
echo "================================"
echo ""

# Check if running on server
if [ ! -f "data/java-latest.osrm.fileIndex" ]; then
    echo "❌ OSRM data not processed!"
    echo "Run: ./MASTER-SETUP.sh first"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not installed!"
    exit 1
fi

# Build images
echo "📦 Building Docker images..."
docker-compose build --no-cache

# Start services
echo "🚀 Starting production services..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 15

# Health check
echo "🏥 Running health checks..."
if curl -sf http://localhost/health > /dev/null; then
    echo "✅ Health check passed!"
else
    echo "❌ Health check failed!"
    docker-compose logs
    exit 1
fi

# Test routing
echo "🧪 Testing routing API..."
if curl -sf "http://localhost/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null; then
    echo "✅ Routing API working!"
else
    echo "⚠️  Routing API might have issues"
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Services available at:"
echo "  - Web Interface: http://$(hostname -I | awk '{print $1}')"
echo "  - Health Check:  http://$(hostname -I | awk '{print $1}')/health"
echo ""
echo "Management commands:"
echo "  docker-compose ps          # Check status"
echo "  docker-compose logs -f     # View logs"
echo "  docker-compose restart     # Restart services"
echo "  docker-compose down        # Stop services"
echo ""
