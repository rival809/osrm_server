#!/bin/bash
# ============================================================================
# Setup Nominatim PostgreSQL+PostGIS for Offline Reverse Geocoding (Linux)
# ============================================================================
# 
# Script ini akan:
# 1. Start PostgreSQL dan Nominatim containers
# 2. Import PBF file (java-latest.osm.pbf) ke PostgreSQL
# 3. Build geocoding index untuk reverse geocoding
#
# Requirements:
# - Docker Engine running
# - PBF file: data/java-latest.osm.pbf (sudah ada)
# - RAM: 4-8GB available
# - Disk: 10-20GB untuk database
# - Time: 2-4 jam untuk import Java Island
#
# ============================================================================

set -e

echo "============================================================"
echo "  NOMINATIM GEOCODING SETUP - JAVA ISLAND"
echo "============================================================"
echo ""

# Check Docker
echo "[1/6] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "  ❌ Docker is not installed!"
    echo "  Please install Docker Engine"
    exit 1
fi
echo "  ✅ Docker is available"

# Check PBF file
echo ""
echo "[2/6] Checking PBF file..."
PBF_FILE="data/java-latest.osm.pbf"
if [ -f "$PBF_FILE" ]; then
    SIZE=$(du -h "$PBF_FILE" | cut -f1)
    echo "  ✅ PBF file found: $PBF_FILE ($SIZE)"
else
    echo "  ❌ PBF file not found: $PBF_FILE"
    echo "  Please run: ./MASTER-SETUP.sh"
    exit 1
fi

# Stop existing containers
echo ""
echo "[3/6] Stopping existing Nominatim containers..."
docker-compose stop nominatim postgres 2>/dev/null || true
docker-compose rm -f nominatim postgres 2>/dev/null || true
echo "  ✅ Cleaned up old containers"

# Start PostgreSQL
echo ""
echo "[4/6] Starting PostgreSQL+PostGIS..."
docker-compose up -d postgres
echo "  Waiting for PostgreSQL to be ready (30 seconds)..."
sleep 30

# Check PostgreSQL health
ATTEMPTS=0
MAX_ATTEMPTS=10
POSTGRES_READY=false

while [ $ATTEMPTS -lt $MAX_ATTEMPTS ] && [ "$POSTGRES_READY" = false ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    echo "  Checking PostgreSQL health (attempt $ATTEMPTS/$MAX_ATTEMPTS)..."
    
    if docker exec osrm-postgres pg_isready -U nominatim 2>&1 | grep -q "accepting connections"; then
        POSTGRES_READY=true
        echo "  ✅ PostgreSQL is ready!"
    else
        sleep 5
    fi
done

if [ "$POSTGRES_READY" = false ]; then
    echo "  ❌ PostgreSQL failed to start!"
    docker-compose logs postgres
    exit 1
fi

# Start Nominatim (will import data on first run)
echo ""
echo "[5/6] Starting Nominatim (this will import PBF data)..."
echo "  ⏳ This will take 2-4 HOURS for Java Island (~550MB PBF)"
echo "  The import happens automatically on first start"
echo ""
echo "  You can monitor progress with:"
echo "    docker-compose logs -f nominatim"
echo ""

docker-compose up -d nominatim

# Wait for Nominatim to start importing
echo "  Waiting for import to begin (60 seconds)..."
sleep 60

# Monitor import status
echo ""
echo "[6/6] Monitoring import status..."
echo "  (Press Ctrl+C to stop monitoring, import will continue in background)"
echo ""

IMPORT_COMPLETE=false
CHECK_COUNT=0
MAX_CHECKS=720 # 6 hours max (30s intervals)

while [ $CHECK_COUNT -lt $MAX_CHECKS ] && [ "$IMPORT_COMPLETE" = false ]; do
    CHECK_COUNT=$((CHECK_COUNT + 1))
    
    # Check if Nominatim status endpoint is responding
    if STATUS=$(curl -s -m 5 "http://localhost:5002/status.php?format=json" 2>/dev/null); then
        if echo "$STATUS" | grep -q '"status":0'; then
            echo "  ✅ NOMINATIM IMPORT COMPLETE!"
            IMPORT_COMPLETE=true
            break
        else
            echo "  ⏳ Import in progress (check $CHECK_COUNT)..."
        fi
    else
        echo "  ⏳ Import in progress (check $CHECK_COUNT)..."
    fi
    
    # Show last 5 lines of logs every 10 checks (5 minutes)
    if [ $((CHECK_COUNT % 10)) -eq 0 ]; then
        echo ""
        echo "  Latest logs:"
        docker-compose logs --tail 5 nominatim | sed 's/^/    /'
        echo ""
    fi
    
    sleep 30
done

if [ "$IMPORT_COMPLETE" = true ]; then
    echo ""
    echo "============================================================"
    echo "  ✅ NOMINATIM SETUP COMPLETE!"
    echo "============================================================"
    echo ""
    echo "Services running:"
    echo "  - PostgreSQL: localhost:5432"
    echo "  - Nominatim: http://localhost:5002"
    echo ""
    echo "Test reverse geocoding:"
    echo "  curl 'http://localhost:5002/reverse?lat=-6.9175&lon=107.6191&format=json'"
    echo ""
    echo "Now start the full stack:"
    echo "  docker-compose up -d"
    echo ""
    echo "Then test via your service:"
    echo "  curl 'http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191'"
    echo ""
else
    echo ""
    echo "============================================================"
    echo "  ⏳ IMPORT STILL RUNNING IN BACKGROUND"
    echo "============================================================"
    echo ""
    echo "The import is continuing in the background."
    echo "Monitor with: docker-compose logs -f nominatim"
    echo ""
    echo "Check status:"
    echo "  curl http://localhost:5002/status.php?format=json"
    echo ""
fi

echo "Database location: Docker volume 'postgres-data'"
echo "To remove and reimport: docker-compose down -v"
echo ""
