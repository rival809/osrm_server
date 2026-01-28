#!/bin/bash
###############################################################################
# Setup Local Tile Server from PBF File
# Works on: Ubuntu/Debian Linux
# 
# This script sets up tileserver-gl to generate tiles from your PBF file
# instead of downloading from tile.openstreetmap.org
###############################################################################

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PBF_FILE="./data/java-latest.osm.pbf"
MBTILES_FILE="./data/java.mbtiles"
TILESERVER_PORT=5001
DOCKER_IMAGE="maptiler/tileserver-gl:latest"

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed!"
        echo ""
        echo "Install Docker:"
        echo "  curl -fsSL https://get.docker.com | sh"
        echo "  sudo usermod -aG docker \$USER"
        echo "  newgrp docker"
        exit 1
    fi
    print_info "Docker found: $(docker --version)"
}

# Check if PBF file exists
check_pbf_file() {
    if [ ! -f "$PBF_FILE" ]; then
        print_error "PBF file not found: $PBF_FILE"
        echo ""
        echo "Download Java Island PBF:"
        echo "  mkdir -p data"
        echo "  cd data"
        echo "  wget http://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
        exit 1
    fi
    
    local size=$(du -h "$PBF_FILE" | cut -f1)
    print_info "PBF file found: $PBF_FILE ($size)"
}

# Convert PBF to MBTiles (required by tileserver-gl)
convert_pbf_to_mbtiles() {
    print_header "Step 1: Convert PBF to MBTiles"
    
    if [ -f "$MBTILES_FILE" ]; then
        print_warning "MBTiles file already exists: $MBTILES_FILE"
        read -p "Regenerate? (y/N): " regenerate
        if [ "$regenerate" != "y" ]; then
            print_info "Skipping conversion"
            return
        fi
        rm -f "$MBTILES_FILE"
    fi
    
    print_info "Converting PBF to MBTiles format..."
    print_info "This may take 10-30 minutes depending on file size..."
    
    # Use planetiler for PBF to MBTiles conversion (more reliable)
    docker pull ghcr.io/onthegomap/planetiler:latest
    
    docker run -it --rm \
        -v "$(pwd)/data:/data" \
        -e JAVA_TOOL_OPTIONS="-Xmx2g" \
        ghcr.io/onthegomap/planetiler:latest \
        --download \
        --area=indonesia \
        --bounds=105.0,-8.8,114.0,-5.9 \
        --output=/data/java.mbtiles \
        --osm-path=/data/java-latest.osm.pbf
    
    if [ $? -eq 0 ]; then
        local size=$(du -h "$MBTILES_FILE" | cut -f1)
        print_info "✅ MBTiles created successfully: $MBTILES_FILE ($size)"
    else
        print_error "Failed to convert PBF to MBTiles"
        exit 1
    fi
}

# Start tileserver-gl
start_tileserver() {
    print_header "Step 2: Start Tile Server"
    
    # Stop existing container if running
    if docker ps -a --format '{{.Names}}' | grep -q '^osrm-tileserver$'; then
        print_info "Stopping existing tileserver container..."
        docker stop osrm-tileserver || true
        docker rm osrm-tileserver || true
    fi
    
    print_info "Starting tileserver-gl on port $TILESERVER_PORT..."
    
    docker run -d \
        --name osrm-tileserver \
        -p $TILESERVER_PORT:8080 \
        -v "$(pwd)/data:/data:ro" \
        --restart unless-stopped \
        $DOCKER_IMAGE \
        --verbose \
        --mbtiles /data/java.mbtiles
    
    if [ $? -eq 0 ]; then
        print_info "✅ Tileserver started successfully"
        print_info "Container: osrm-tileserver"
        print_info "Port: $TILESERVER_PORT"
    else
        print_error "Failed to start tileserver"
        exit 1
    fi
}

# Test tileserver
test_tileserver() {
    print_header "Step 3: Test Tile Server"
    
    print_info "Waiting for tileserver to be ready..."
    sleep 5
    
    # Test health endpoint
    if curl -sf http://localhost:$TILESERVER_PORT/health > /dev/null 2>&1; then
        print_info "✅ Health check passed"
    else
        print_warning "Health endpoint not available (this is normal for some versions)"
    fi
    
    # Test tile endpoint
    print_info "Testing tile generation..."
    local test_tile="http://localhost:$TILESERVER_PORT/styles/basic-preview/12/3230/1830.png"
    
    if curl -sf -o /tmp/test-tile.png "$test_tile"; then
        local size=$(du -h /tmp/test-tile.png | cut -f1)
        print_info "✅ Tile generation successful (size: $size)"
        rm -f /tmp/test-tile.png
    else
        print_error "Failed to generate test tile"
        echo "Check logs: docker logs osrm-tileserver"
        exit 1
    fi
}

# Update .env configuration
update_env_config() {
    print_header "Step 4: Update Configuration"
    
    local env_file=".env"
    
    if [ ! -f "$env_file" ]; then
        print_info "Creating .env from .env.example..."
        cp .env.example "$env_file"
    fi
    
    print_info "Updating $env_file with tileserver settings..."
    
    # Update or add TILE_SERVER_URL
    if grep -q "TILE_SERVER_URL=" "$env_file"; then
        sed -i "s|TILE_SERVER_URL=.*|TILE_SERVER_URL=http://localhost:$TILESERVER_PORT/styles/basic-preview|g" "$env_file"
    else
        echo "TILE_SERVER_URL=http://localhost:$TILESERVER_PORT/styles/basic-preview" >> "$env_file"
    fi
    
    print_info "✅ Configuration updated"
    echo ""
    echo "Updated settings in $env_file:"
    echo "  TILE_SERVER_URL=http://localhost:$TILESERVER_PORT/styles/basic-preview"
}

# Display summary
display_summary() {
    print_header "Setup Complete!"
    
    echo ""
    echo -e "${GREEN}✅ Local Tile Server is Running${NC}"
    echo ""
    echo "📊 Service Information:"
    echo "  • Container: osrm-tileserver"
    echo "  • Port: $TILESERVER_PORT"
    echo "  • Status: docker ps | grep osrm-tileserver"
    echo "  • Logs: docker logs -f osrm-tileserver"
    echo ""
    echo "🌐 Tile Server URLs:"
    echo "  • Viewer: http://localhost:$TILESERVER_PORT"
    echo "  • Tiles: http://localhost:$TILESERVER_PORT/styles/basic-preview/{z}/{x}/{y}.png"
    echo "  • Example: http://localhost:$TILESERVER_PORT/styles/basic-preview/12/3230/1830.png"
    echo ""
    echo "🚀 Next Steps:"
    echo "  1. Start OSRM tile service:"
    echo "     npm start"
    echo ""
    echo "  2. Test tile endpoint:"
    echo "     curl http://localhost:8080/tiles/12/3230/1830.png -o test.png"
    echo ""
    echo "  3. View logs:"
    echo "     docker logs -f osrm-tileserver"
    echo ""
    echo "💡 Tips:"
    echo "  • Tiles are generated on-demand from your PBF file"
    echo "  • First request per tile will be slower (generating)"
    echo "  • Subsequent requests are cached and fast"
    echo "  • No need to download from tile.openstreetmap.org!"
    echo ""
}

# Main execution
main() {
    print_header "Local Tile Server Setup"
    echo "This script will set up tileserver-gl to serve tiles from your PBF file"
    echo ""
    
    check_docker
    check_pbf_file
    
    echo ""
    read -p "Continue with setup? (y/N): " confirm
    if [ "$confirm" != "y" ]; then
        print_info "Setup cancelled"
        exit 0
    fi
    
    convert_pbf_to_mbtiles
    start_tileserver
    test_tileserver
    update_env_config
    display_summary
}

# Run main function
main
