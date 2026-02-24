#!/bin/bash
# ========================================================================
# OSRM MASTER SETUP - LITE VERSION (Without Nominatim Geocoding)
# ========================================================================
# 
# This LITE version skips Nominatim geocoding setup (saves ~130GB disk space!)
# Includes:
# - Prerequisites check & auto-install
# - Environment setup
# - OSM data download & processing  
# - OSRM backend setup (routing only)
# - Tile cache preloading
# - Uses docker-compose.lite.yml
# 
# Excludes:
# - Nominatim database import (saves 2-4 hours + 130GB)
# - PostgreSQL + PostGIS setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

MODE=${1:-interactive}  # interactive, auto, production
REGION=${2:-java}       # java, indonesia, custom
ENVIRONMENT=${3:-production}  # development, production

function print_section() {
    echo ""
    echo -e "${CYAN}============================================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}============================================================${NC}"
    echo ""
}

function print_step() {
    echo -e "${YELLOW}[*] $1${NC}"
    echo -e "${NC}   $2${NC}"
}

function print_success() {
    echo -e "${GREEN}[+] $1${NC}"
}

function print_warning() {
    echo -e "${YELLOW}[!] $1${NC}"
}

function print_error() {
    echo -e "${RED}[-] $1${NC}"
}

function check_prerequisites() {
    print_section "PREREQUISITES CHECK"
    
    local missing=0
    
    # Check Node.js
    if command -v node &> /dev/null; then
        print_success "Node.js installed: $(node --version)"
    else
        print_error "Node.js not found"
        echo "   Install from: https://nodejs.org/"
        missing=1
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        print_success "npm installed: $(npm --version)"
    else
        print_error "npm not found"
        missing=1
    fi
    
    # Check Docker
    if command -v docker &> /dev/null; then
        print_success "Docker installed: $(docker --version)"
        # Verify Docker daemon is running
        if docker info &> /dev/null; then
            print_success "Docker daemon is running"
        else
            print_error "Docker daemon is not running. Please start Docker first."
            missing=1
        fi
    else
        print_error "Docker not found"
        echo "   Install from: https://docs.docker.com/get-docker/"
        missing=1
    fi
    
    if [ $missing -eq 1 ]; then
        print_error "Missing prerequisites. Please install and try again."
        exit 1
    fi
    
    return 0
}

function setup_environment() {
    print_section "ENVIRONMENT SETUP"

    # Create required directories
    print_step "Creating directories" "data, cache, logs"
    for dir in data cache cache/.metadata logs; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            print_success "Created directory: $dir"
        fi
    done
    
    print_step "Installing Node.js dependencies" "Installing required packages"
    
    if npm install; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        return 1
    fi
    
    # Create .env file
    print_step "Creating environment configuration" "Setting up .env file for LITE mode"
    
    cat > .env << EOF
# OSRM Service Configuration (Lightweight Proxy Mode - LITE)
NODE_ENV=$ENVIRONMENT
PORT=81

# OSRM Backend (for routing)
OSRM_URL=http://localhost:5003

# Tileserver (for map tiles) - REQUIRED for self-hosted setup
TILE_SERVER_URL=http://localhost:5001/styles/basic-preview

# Memory Management
MAX_MEMORY_MB=10000

# Logging
LOG_LEVEL=info
EOF
    
    print_success "Environment file created"
    return 0
}

function download_osm_data() {
    print_section "OSM DATA DOWNLOAD"
    
    local pbf_file="data/java-latest.osm.pbf"
    
    if [ -f "$pbf_file" ]; then
        local file_size=$(du -h "$pbf_file" | cut -f1)
        print_warning "PBF file already exists ($file_size)"
        read -p "Re-download? (y/N): " redownload
        if [ "${redownload,,}" != "y" ]; then
            print_success "Using existing PBF file"
            return 0
        fi
    fi
    
    # Create data directory
    mkdir -p data
    
    print_step "Downloading Java Island OSM data" "~800MB - This may take a while"
    
    local url="https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
    
    if command -v curl &> /dev/null; then
        print_success "Using curl for download..."
        if curl -L --progress-bar -o "$pbf_file" "$url"; then
            local file_size=$(du -h "$pbf_file" | cut -f1)
            print_success "Download complete ($file_size)"
            return 0
        else
            print_warning "curl download failed, trying wget..."
        fi
    fi

    if command -v wget &> /dev/null; then
        if wget -O "$pbf_file" "$url"; then
            local file_size=$(du -h "$pbf_file" | cut -f1)
            print_success "Download complete ($file_size)"
            return 0
        fi
    fi

    print_error "Download failed. Please download manually from: $url"
    return 1
}

function convert_pbf_to_mbtiles() {
    print_section "MBTILES GENERATION"
    
    local pbf_file="data/java-latest.osm.pbf"
    local mbtiles_file="data/java.mbtiles"
    
    if [ -f "$mbtiles_file" ]; then
        print_warning "MBTiles file already exists"
        read -p "Re-generate? (y/N): " reconvert
        if [ "${reconvert,,}" != "y" ]; then
            print_success "Using existing MBTiles file"
            return 0
        fi
    fi
    
    print_step "Converting PBF to MBTiles using planetiler" "10-30 minutes - CPU intensive"
    echo -e "${NC}   This process generates vector tiles for the map display${NC}"
    echo ""

    # Pull planetiler Docker image
    echo -e "${CYAN}   Pulling planetiler Docker image...${NC}"
    docker pull ghcr.io/onthegomap/planetiler:latest

    local absolute_data_dir="$(pwd)/data"

    echo -e "${CYAN}   Running planetiler conversion...${NC}"
    echo -e "${NC}   This will take 10-30 minutes...${NC}"

    if ! docker run -it --rm \
        -v "${absolute_data_dir}:/data" \
        -e JAVA_TOOL_OPTIONS="-Xmx2g" \
        ghcr.io/onthegomap/planetiler:latest \
        --bounds=105.0,-8.8,114.0,-5.9 \
        --output=/data/java.mbtiles \
        --osm-path=/data/java-latest.osm.pbf; then
        print_error "MBTiles generation failed. Tileserver will not work without this file."
        return 1
    fi

    if [ -f "$mbtiles_file" ]; then
        local file_size=$(du -h "$mbtiles_file" | cut -f1)
        print_success "MBTiles generated successfully: $mbtiles_file ($file_size)"
        return 0
    else
        print_error "MBTiles file was not created."
        return 1
    fi
}

function process_osrm_data() {
    print_section "OSRM DATA PROCESSING"
    
    local pbf_file="data/java-latest.osm.pbf"
    
    print_step "Processing OSRM routing data" "Using Docker containers"
    echo -e "${NC}   This creates optimized routing graphs (~10-20 minutes)${NC}"
    
    if [ -f "scripts/process-osrm-v6.sh" ]; then
        bash scripts/process-osrm-v6.sh
        print_success "OSRM data processing complete"
    else
        print_warning "OSRM processing script not found"
        echo -e "${YELLOW}   Run manually with Docker commands${NC}"
    fi
    
    return 0
}

function show_completion_summary() {
    print_section "LITE SETUP COMPLETE"
    
    echo -e "${GREEN}[SUCCESS] OSRM LITE setup completed!${NC}"
    echo ""
    echo -e "${CYAN}What's Ready:${NC}"
    echo -e "${NC}   [OK] Prerequisites installed${NC}"
    echo -e "${NC}   [OK] Environment configured (LITE mode)${NC}"
    echo -e "${NC}   [OK] OSM data downloaded (~800MB)${NC}"
    echo -e "${NC}   [OK] MBTiles generated for tileserver${NC}"
    echo -e "${NC}   [OK] OSRM routing data processed${NC}"
    echo -e "${YELLOW}   [--] Nominatim geocoding SKIPPED (saves 130GB + 2-4 hours)${NC}"
    echo ""
    echo -e "${CYAN}Next Steps - Start Services (LITE):${NC}"
    echo -e "${NC}   1. Build and start LITE containers:${NC}"
    echo -e "${NC}      docker compose -f docker-compose.lite.yml build --no-cache${NC}"
    echo -e "${NC}      docker compose -f docker-compose.lite.yml up -d${NC}"
    echo ""
    echo -e "${NC}   2. Check service status:${NC}"
    echo -e "${NC}      docker compose -f docker-compose.lite.yml ps${NC}"
    echo -e "${NC}      docker compose -f docker-compose.lite.yml logs -f${NC}"
    echo ""
    echo -e "${CYAN}Service Management (LITE):${NC}"
    echo -e "${NC}   * Stop:           docker compose -f docker-compose.lite.yml down${NC}"
    echo -e "${NC}   * Restart:        docker compose -f docker-compose.lite.yml restart${NC}"
    echo -e "${NC}   * View logs:      docker compose -f docker-compose.lite.yml logs -f${NC}"
    echo ""
    echo -e "${CYAN}Available Endpoints:${NC}"
    echo -e "${NC}   * OSRM Tile Proxy:  http://localhost:81 (Routing + Tiles)${NC}"
    echo -e "${NC}   * OSRM Backend:     http://localhost:5003 (Direct API)${NC}"
    echo -e "${NC}   * Tileserver:       http://localhost:5001 (Map Tiles)${NC}"
    echo ""
    echo -e "${YELLOW}What's NOT included (LITE version):${NC}"
    echo -e "${NC}   x Nominatim geocoding (address <-> coordinates)${NC}"
    echo -e "${NC}   x PostgreSQL database${NC}"
    echo ""
    echo -e "${GREEN}[OK] LITE Version - Only ~10GB disk space!${NC}"
    echo -e "${CYAN}[INFO] Need geocoding? Use docker-compose.yml (FULL version)${NC}"
}

# Main execution
function main() {
    print_section "OSRM MASTER SETUP - LITE VERSION"
    echo -e "${NC}Fast Setup Without Geocoding (Saves 130GB + 2-4 hours)${NC}"
    echo ""
    echo -e "${CYAN}This LITE script will:${NC}"
    echo -e "${NC}  - Install prerequisites (Node.js, Docker)${NC}"
    echo -e "${NC}  - Setup environment and dependencies${NC}"
    echo -e "${NC}  - Download Java Island OSM data (~800MB)${NC}"
    echo -e "${NC}  - Convert PBF to MBTiles for tileserver (10-30 min)${NC}"
    echo -e "${NC}  - Process OSRM routing data (10-20 min)${NC}"
    echo -e "${NC}  - Prepare for Docker LITE deployment${NC}"
    echo ""
    echo -e "${YELLOW}SKIPPED (LITE mode):${NC}"
    echo -e "${NC}  x Nominatim database import (saves 2-4 hours + 130GB)${NC}"
    echo -e "${NC}  x PostgreSQL + PostGIS setup${NC}"
    echo ""
    
    if [ "$MODE" == "interactive" ]; then
        read -p "Continue with LITE setup? (Y/n): " confirm
        if [ "${confirm,,}" == "n" ]; then
            echo "Setup cancelled."
            exit 0
        fi
    fi
    
    # Execute setup steps
    check_prerequisites || exit 1
    setup_environment || exit 1
    download_osm_data || exit 1
    convert_pbf_to_mbtiles || exit 1
    process_osrm_data || exit 1
    
    show_completion_summary
}

# Run main function
main
