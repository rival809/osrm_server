#!/bin/bash

# Script untuk test API endpoints OSRM service

echo "🧪 Testing OSRM Service API Endpoints"
echo "====================================="
echo ""

BASE_URL="http://localhost:3000"
OSRM_URL="http://localhost:5000"

# Function to test endpoint
test_endpoint() {
    local name="$1"
    local url="$2"
    local description="$3"
    
    echo -n "Testing $name: "
    if curl -s -f "$url" > /dev/null; then
        echo "✅ OK - $description"
    else
        echo "❌ FAILED - $description"
    fi
}

echo "📡 Testing API Server (Node.js)..."
test_endpoint "Health Check" "$BASE_URL/" "Web interface"
test_endpoint "Routing API" "$BASE_URL/route?start=-6.2088,106.8456&end=-6.1753,106.8894" "Route calculation"
test_endpoint "Tiles API" "$BASE_URL/tiles/10/511/511.png" "Tile serving"
test_endpoint "Cache Stats" "$BASE_URL/cache/stats" "Cache statistics"

echo ""
echo "🗺️  Testing OSRM Backend..."
test_endpoint "OSRM Health" "$OSRM_URL/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" "OSRM routing"

echo ""
echo "📊 Detailed Cache Stats:"
curl -s "$BASE_URL/cache/stats" | jq '.' 2>/dev/null || curl -s "$BASE_URL/cache/stats"

echo ""
echo "🎯 Test completed!"
echo ""
echo "💡 Available endpoints:"
echo "   $BASE_URL/ - Web interface"
echo "   $BASE_URL/route - Routing API"
echo "   $BASE_URL/tiles/{z}/{x}/{y}.png - Tiles API"
echo "   $BASE_URL/cache/stats - Cache statistics"
echo "   $OSRM_URL/route/v1/driving/lon1,lat1;lon2,lat2 - OSRM API"