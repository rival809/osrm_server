#!/bin/bash

# Complete setup script for OSRM service with tile caching

echo "OSRM Service Complete Setup"
echo "==========================="
echo ""
echo "This script will set up your OSRM service with tile caching:"
echo "  1. Install dependencies"
echo "  2. Download OSM data (if needed)"
echo "  3. Process OSRM data"
echo "  4. Start OSRM backend"
echo "  5. Start API server"
echo ""

# Function to pause and wait for user input
wait_continue() {
    echo "Press any key to continue..."
    read -n 1 -s
    echo ""
}

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "   Node.js: $NODE_VERSION"
else
    echo "   Node.js not found"
    echo "      Please install Node.js from https://nodejs.org"
    exit 1
fi

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo "   Docker: $DOCKER_VERSION"
else
    echo "   Docker not found"
    echo "      Please install Docker"
    exit 1
fi

# Check if Docker is running
if docker ps > /dev/null 2>&1; then
    echo "   Docker is running"
else
    echo "   Docker is not running"
    echo "      Please start Docker service"
    exit 1
fi

echo ""
echo "All prerequisites OK! Starting setup..."

# Step 1: Install Dependencies
echo ""
echo "=================================================="
echo "Step 1/5: Installing Dependencies"
echo "=================================================="
if npm install; then
    echo "Dependencies installed successfully"
else
    echo "Failed to install dependencies"
    exit 1
fi

wait_continue

# Step 2: Download OSM Data (if not exists)
echo ""
echo "=================================================="
echo "Step 2/5: OSM Data"
echo "=================================================="

PBF_FILE="data/java-latest.osm.pbf"
if [ -f "$PBF_FILE" ]; then
    FILE_SIZE=$(du -m "$PBF_FILE" | cut -f1)
    echo "OSM data already exists: ${FILE_SIZE} MB"
else
    echo "Downloading OSM data for Java..."
    echo "This will download ~180MB, may take several minutes"
    echo ""
    
    if ./scripts/download-pbf.sh; then
        echo "OSM data downloaded successfully"
    else
        echo "Failed to download OSM data"
        exit 1
    fi
fi

wait_continue

# Step 3: Process OSRM Data
echo ""
echo "=================================================="
echo "Step 3/5: Processing OSRM Data"
echo "=================================================="

# Check if OSRM files exist
OSRM_FILES=("data/java-latest.osrm" "data/java-latest.osrm.hsgr" "data/java-latest.osrm.ch")
MISSING_FILES=()
for file in "${OSRM_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -eq 0 ]; then
    echo "OSRM data already processed"
else
    echo "Processing OSRM data (extract, partition, customize)..."
    echo "This may take several minutes"
    echo ""
    
    if ./scripts/process-osrm-v6.sh; then
        echo "OSRM data processed successfully"
    else
        echo "Failed to process OSRM data"
        exit 1
    fi
fi

wait_continue

# Step 4: Start OSRM Backend
echo ""
echo "=================================================="
echo "Step 4/5: Starting OSRM Backend"
echo "=================================================="

echo "Starting OSRM backend container..."
if docker-compose up -d osrm-backend; then
    sleep 10
    
    # Test OSRM health
    echo "Testing OSRM backend..."
    if curl -s -f "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null; then
        echo "OSRM backend is running and healthy"
    else
        echo "Failed to start OSRM backend"
        exit 1
    fi
else
    echo "Failed to start OSRM backend"
    exit 1
fi

wait_continue

# Step 5: Setup Complete & Start API Server
echo ""
echo "=================================================="
echo "Step 5/5: Starting API Server"
echo "=================================================="

echo "Setup completed successfully!"
echo ""
echo "System Status:"
echo "   OSM Data: Ready (Jawa Barat)"
echo "   OSRM Backend: Running (Port 5000)"
echo "   Cache System: Ready"
echo ""
echo "Starting API server..."
echo ""
echo "Available endpoints:"
echo "   http://localhost:3000/route - Routing API"
echo "   http://localhost:3000/tiles/{z}/{x}/{y}.png - Tiles API"
echo "   http://localhost:3000/cache/stats - Cache statistics"
echo "   http://localhost:3000/ - Web interface"
echo ""
echo "To manage cache and preload tiles, run:"
echo "   ./CACHE-MANAGER.sh"
echo ""
echo "Press Ctrl+C to stop the server when done."
echo ""
echo "=================================================="
echo ""

# Start API server
npm start