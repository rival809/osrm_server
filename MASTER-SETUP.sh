#!/bin/bash

# ========================================================================
# OSRM MASTER SETUP - Complete End-to-End Setup for Linux
# ========================================================================
# 
# This script handles EVERYTHING from fresh clone to production deployment:
# - Prerequisites check & auto-install
# - Environment setup
# - OSM data download & processing  
# - OSRM backend setup
# - Tile cache preloading
# - Production deployment
# - Health checks & validation
# - Error recovery & troubleshooting

set -e  # Exit on any error

# Configuration
MODE="${1:-interactive}"        # interactive, auto, production
REGION="${2:-java}"            # java, indonesia, custom
ENVIRONMENT="${3:-development}" # development, production

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Functions
print_section() {
    echo ""
    echo -e "${CYAN}============================================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}============================================================${NC}"
    echo ""
}

print_step() {
    echo -e "${YELLOW}[*] $1${NC}"
    echo -e "${GRAY}   $2${NC}"
}

print_success() {
    echo -e "${GREEN}[+] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[!] $1${NC}"
}

print_error() {
    echo -e "${RED}[-] $1${NC}"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. Some package installations will use system paths."
        return 0
    fi
    return 1
}

# Install system packages
install_system_packages() {
    print_step "Installing system packages" "curl, wget, jq, bc"
    
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y curl wget jq bc build-essential
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        sudo yum update -y
        sudo yum install -y curl wget jq bc gcc gcc-c++ make
    elif command -v pacman &> /dev/null; then
        # Arch Linux
        sudo pacman -Sy --noconfirm curl wget jq bc base-devel
    else
        print_error "Unsupported Linux distribution. Please install curl, wget, jq, bc manually."
        return 1
    fi
    
    print_success "System packages installed"
}

# Install Node.js (internal function - only called when needed)
install_nodejs() {
    print_step "Installing Node.js" "JavaScript runtime"
    print_warning "Node.js not found, installing..."
    
    # Install Node.js via NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        sudo yum install -y nodejs npm
    else
        print_error "Please install Node.js manually from https://nodejs.org/"
        return 1
    fi
    
    # Verify installation
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js installed: $NODE_VERSION"
    else
        print_error "Node.js installation failed"
        return 1
    fi
}

# Install Docker (internal function - only called when needed)
install_docker() {
    print_step "Installing Docker" "Container platform"
    print_warning "Docker not found, installing..."
    
    # Install prerequisites
    sudo apt update
    sudo apt install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    
    # Add Docker's official GPG key
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    
    # Add Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine and plugins
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    # Enable and start Docker service
    sudo systemctl enable docker
    sudo systemctl start docker
    
    print_success "Docker installed"
    print_warning "Group membership updated - you may need to logout/login for docker group to take effect"
    print_warning "Script will continue using sudo for docker commands..."
}

# Install prerequisites
install_prerequisites() {
    print_section "PREREQUISITES INSTALLATION"
    
    # First check if prerequisites are already installed
    local node_installed=false
    local docker_installed=false
    local need_system_packages=false
    
    if command -v node &> /dev/null; then
        node_installed=true
    fi
    
    if command -v docker &> /dev/null; then
        docker_installed=true
    fi
    
    # Check if basic system packages are available
    if ! command -v curl &> /dev/null || ! command -v wget &> /dev/null || ! command -v jq &> /dev/null || ! command -v bc &> /dev/null; then
        need_system_packages=true
    fi
    
    # Install system packages if needed
    if [ "$need_system_packages" = true ]; then
        install_system_packages || return 1
    else
        print_step "Checking system packages" "curl, wget, jq, bc"
        print_success "System packages already available"
    fi
    
    # Verify curl or wget for downloads (at least one required)
    print_step "Checking download utilities" "curl or wget required"
    local has_curl=false
    local has_wget=false
    
    if command -v curl &> /dev/null; then
        has_curl=true
        CURL_VERSION=$(curl --version 2>/dev/null | head -n1)
        echo "   ${GREEN}✓${NC} curl available: $CURL_VERSION"
    fi
    
    if command -v wget &> /dev/null; then
        has_wget=true
        WGET_VERSION=$(wget --version 2>/dev/null | head -n1)
        echo "   ${GREEN}✓${NC} wget available: $WGET_VERSION"
    fi
    
    if [ "$has_curl" = true ] || [ "$has_wget" = true ]; then
        if [ "$has_curl" = true ]; then
            print_success "Download tools ready (curl preferred for faster downloads)"
        else
            print_success "Download tools ready (wget available)"
        fi
    else
        print_error "Neither curl nor wget found!"
        print_warning "At least one is required for downloading OSM data"
        return 1
    fi
    
    # Install Node.js if not installed
    if [ "$node_installed" = false ]; then
        install_nodejs || return 1
    else
        print_step "Checking Node.js" "JavaScript runtime"
        NODE_VERSION=$(node --version)
        print_success "Node.js already installed: $NODE_VERSION"
    fi
    
    # Install Docker if not installed
    if [ "$docker_installed" = false ]; then
        install_docker || return 1
    else
        print_step "Checking Docker" "Container platform"
        DOCKER_VERSION=$(docker --version)
        print_success "Docker already installed: $DOCKER_VERSION"
        
        # Check Docker Compose (plugin or standalone)
        if docker compose version &> /dev/null; then
            COMPOSE_VERSION=$(docker compose version)
            print_success "Docker Compose plugin installed: $COMPOSE_VERSION"
        elif command -v docker-compose &> /dev/null; then
            COMPOSE_VERSION=$(docker-compose --version)
            print_success "Docker Compose standalone installed: $COMPOSE_VERSION"
        else
            print_warning "Docker Compose not found, installing plugin..."
            sudo apt-get update
            sudo apt-get install -y docker-compose-plugin
            print_success "Docker Compose plugin installed"
        fi
        
        # Check if Docker is running
        print_step "Checking Docker status" "Verify Docker daemon is running"
        if docker ps > /dev/null 2>&1; then
            print_success "Docker is running"
        else
            print_warning "Docker is not running. Starting Docker..."
            sudo systemctl start docker
            sudo systemctl enable docker
            
            # Wait for Docker to start
            sleep 5
            if docker ps > /dev/null 2>&1; then
                print_success "Docker started successfully"
            else
                print_error "Failed to start Docker"
                return 1
            fi
        fi
    fi
    
    return 0
}

# Setup environment
setup_environment() {
    print_section "ENVIRONMENT SETUP"
    
    # Create directories
    print_step "Creating directories" "Data, cache, and log directories"
    directories=("data" "cache" "cache/.metadata" "logs")
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            print_success "Created directory: $dir"
        fi
    done
    
    # Setup .env file
    print_step "Setting up environment variables" "Creating .env configuration"
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# OSRM Service Configuration
NODE_ENV=$ENVIRONMENT
PORT=8080

# OSRM Backend
OSRM_URL=http://localhost:5000

# Cache Configuration
CACHE_DIR=./cache
CACHE_MODE=smart
PRELOAD_ENABLED=false
TILE_CACHE_TTL=86400000
MAX_CACHE_SIZE_MB=2000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF
        print_success "Created .env file"
    else
        print_success ".env file already exists"
    fi
    
    # Install Node.js dependencies
    print_step "Installing Node.js dependencies" "npm install"
    if npm install; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        return 1
    fi
    
    return 0
}

# Download OSM data
download_osm_data() {
    print_section "OSM DATA DOWNLOAD"
    
    local data_file="data/java-latest.osm.pbf"
    
    if [ -f "$data_file" ]; then
        local size_mb=$(du -m "$data_file" | cut -f1)
        print_success "OSM data already exists: $data_file (${size_mb}MB)"
        
        if [ "$MODE" = "interactive" ]; then
            echo ""
            read -p "Do you want to re-download OSM data? (y/N): " redownload
            if [ "$redownload" != "y" ] && [ "$redownload" != "Y" ]; then
                print_success "Using existing OSM data"
                return 0
            fi
            print_warning "Re-downloading OSM data..."
        else
            print_success "Using existing OSM data (auto mode)"
            return 0
        fi
    fi
    
    print_step "Downloading Java Island OSM data" "~800MB download from Geofabrik"
    local url="https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
    
    # Create data directory if it doesn't exist
    mkdir -p data
    
    # Try curl first (usually faster and better progress display)
    if command -v curl &> /dev/null; then
        echo "${CYAN}Using curl for download...${NC}"
        echo "Starting download..."
        echo ""
        
        if curl -L --progress-bar -o "$data_file" "$url"; then
            echo ""
            print_success "OSM data downloaded successfully"
            local size_mb=$(du -m "$data_file" | cut -f1)
            echo "   File size: ${size_mb}MB"
            return 0
        else
            print_warning "curl download failed, trying wget..."
        fi
    fi
    
    # Fallback to wget
    if command -v wget &> /dev/null; then
        echo "${CYAN}Using wget for download...${NC}"
        
        if wget --progress=bar:force --show-progress -O "$data_file" "$url" 2>&1; then
            print_success "OSM data downloaded successfully"
            return 0
        else
            print_error "Failed to download OSM data"
            print_warning "You can download manually from: $url"
            return 1
        fi
    fi
    
    print_error "Neither curl nor wget found. Please install one of them."
    print_warning "You can download manually from: $url"
    return 1
}

# Process OSRM data
process_osrm_data() {
    print_section "OSRM DATA PROCESSING"
    
    local pbf_file="data/java-latest.osm.pbf"
    if [ ! -f "$pbf_file" ]; then
        print_error "OSM PBF file not found. Please download first."
        return 1
    fi
    
    # Check if all required OSRM files exist (MLD algorithm requirements)
    local required_files=(
        "data/java-latest.osrm"
        "data/java-latest.osrm.cells"
        "data/java-latest.osrm.cell_metrics"
        "data/java-latest.osrm.cnbg"
        "data/java-latest.osrm.cnbg_to_ebg"
        "data/java-latest.osrm.datasource_names"
        "data/java-latest.osrm.ebg_nodes"
        "data/java-latest.osrm.edges"
        "data/java-latest.osrm.enw"
        "data/java-latest.osrm.fileIndex"
        "data/java-latest.osrm.geometry"
        "data/java-latest.osrm.icd"
        "data/java-latest.osrm.maneuver_overrides"
        "data/java-latest.osrm.mldgr"
        "data/java-latest.osrm.names"
        "data/java-latest.osrm.nbg_nodes"
        "data/java-latest.osrm.partition"
        "data/java-latest.osrm.properties"
        "data/java-latest.osrm.restrictions"
        "data/java-latest.osrm.timestamp"
        "data/java-latest.osrm.tld"
        "data/java-latest.osrm.tls"
        "data/java-latest.osrm.turn_duration_penalties"
        "data/java-latest.osrm.turn_penalties_index"
        "data/java-latest.osrm.turn_weight_penalties"
    )
    
    local all_files_exist=true
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            all_files_exist=false
            break
        fi
    done
    
    if [ "$all_files_exist" = true ]; then
        print_success "OSRM data already processed and complete (26 files found)"
        
        if [ "$MODE" = "interactive" ]; then
            echo ""
            read -p "Do you want to reprocess OSRM data? (y/N): " reprocess
            if [ "$reprocess" != "y" ] && [ "$reprocess" != "Y" ]; then
                print_success "Skipping OSRM processing, using existing data"
                return 0
            fi
            print_warning "Reprocessing OSRM data..."
        else
            print_success "Using existing OSRM data (auto mode)"
            return 0
        fi
    fi
    
    # Clean up any incomplete/old OSRM files
    print_step "Cleaning up old OSRM files" "Removing incomplete data"
    local old_count=$(find data -name "java-latest.osrm*" -type f 2>/dev/null | wc -l)
    if [ $old_count -gt 0 ]; then
        find data -name "java-latest.osrm*" -type f -delete 2>/dev/null
        echo "   Removed $old_count old file(s)"
    fi
    
    print_step "Processing OSM data for routing" "This may take 10-20 minutes"
    echo ""
    
    local absolute_data_dir="$(pwd)/data"
    local osrm_image="ghcr.io/project-osrm/osrm-backend:v6.0.0"
    
    # Extract
    echo -e "${CYAN}Step 1/3: Extracting...${NC}"
    echo -e "${GRAY}   This will take 5-10 minutes...${NC}"
    if ! docker run -t -v "${absolute_data_dir}:/data" $osrm_image osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf; then
        print_error "Extract failed"
        return 1
    fi
    print_success "Extract completed"
    
    # Partition
    echo -e "${CYAN}Step 2/3: Partitioning...${NC}"
    echo -e "${GRAY}   This will take 3-5 minutes...${NC}"
    if ! docker run -t -v "${absolute_data_dir}:/data" $osrm_image osrm-partition /data/java-latest.osrm; then
        print_error "Partition failed"
        return 1
    fi
    print_success "Partition completed"
    
    # Customize
    echo -e "${CYAN}Step 3/3: Customizing...${NC}"
    echo -e "${GRAY}   This will take 2-5 minutes...${NC}"
    if ! docker run -t -v "${absolute_data_dir}:/data" $osrm_image osrm-customize /data/java-latest.osrm; then
        print_error "Customize failed"
        return 1
    fi
    print_success "Customize completed"
    
    echo ""
    print_success "OSRM data processing completed successfully!"
    echo -e "${GRAY}   All required files have been generated${NC}"
    return 0
}

# Start services
start_services() {
    print_section "STARTING SERVICES"
    
    # Start ALL services (Backend + API + Nginx)
    print_step "Starting all services" "OSRM Backend, API servers, and Nginx"
    if docker-compose up --build -d; then
        print_success "All services started"
    else
        print_error "Failed to start services"
        return 1
    fi
    
    # Wait for containers to initialize
    print_step "Waiting for containers to initialize" "15 seconds"
    sleep 15
    
    # Check container status
    print_step "Checking container status" "docker ps"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    # Wait for OSRM Backend to be ready (check container logs)
    print_step "Waiting for OSRM Backend" "Checking container status"
    local max_attempts=20
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        sleep 3
        # Check if container is running and healthy
        local backend_status=$(docker inspect osrm-backend --format='{{.State.Running}}' 2>/dev/null)
        if [ "$backend_status" = "true" ]; then
            # Check logs for "running and waiting for requests"
            if docker logs osrm-backend 2>&1 | grep -q "running and waiting for requests"; then
                print_success "OSRM Backend is running"
                break
            fi
        fi
        
        ((attempt++))
        echo -e "${GRAY}Attempt $attempt/$max_attempts...${NC}"
        if [ $attempt -eq $max_attempts ]; then
            print_error "OSRM Backend not ready"
            echo -e "${YELLOW}Checking logs...${NC}"
            docker logs osrm-backend --tail 20
            return 1
        fi
    done
    
    # Wait for API servers to be ready (check container health status)
    print_step "Waiting for API servers" "Checking container health"
    attempt=0
    max_attempts=15
    
    while [ $attempt -lt $max_attempts ]; do
        sleep 2
        # Check if at least one API container is healthy
        local api1_health=$(docker inspect osrm-api-1 --format='{{.State.Health.Status}}' 2>/dev/null)
        local api2_health=$(docker inspect osrm-api-2 --format='{{.State.Health.Status}}' 2>/dev/null)
        
        if [ "$api1_health" = "healthy" ] || [ "$api2_health" = "healthy" ]; then
            print_success "API servers are healthy"
            break
        fi
        
        ((attempt++))
        echo -e "${GRAY}Attempt $attempt/$max_attempts (API1: $api1_health, API2: $api2_health)...${NC}"
        if [ $attempt -eq $max_attempts ]; then
            print_warning "API servers not yet healthy, continuing anyway..."
        fi
    done
    
    # Wait for Nginx to be ready
    print_step "Waiting for Nginx" "Health check on port 80"
    attempt=0
    max_attempts=10
    
    while [ $attempt -lt $max_attempts ]; do
        sleep 2
        if curl -s -f "http://localhost/health" > /dev/null 2>&1; then
            print_success "Nginx is healthy"
            break
        else
            ((attempt++))
            echo -e "${GRAY}Attempt $attempt/$max_attempts...${NC}"
            if [ $attempt -eq $max_attempts ]; then
                print_warning "Nginx not responding"
                echo -e "${YELLOW}Checking logs...${NC}"
                docker logs osrm-nginx --tail 20
            fi
        fi
    done
    
    return 0
}

# Test deployment
test_deployment() {
    print_section "DEPLOYMENT TESTING"
    
    # Test routing through Nginx (public endpoint)
    print_step "Testing routing through Nginx" "Public API endpoint"
    if curl -s -f "http://localhost/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null 2>&1; then
        print_success "Public routing API working"
    else
        print_warning "Public routing test failed"
        echo -e "${GRAY}   Testing direct API...${NC}"
        if curl -s -f "http://localhost:8080/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null 2>&1; then
            print_warning "Direct API works, but Nginx routing may have issues"
        fi
    fi
    
    # Test web interface
    print_step "Testing web interface" "HTML page"
    if curl -s -f "http://localhost/" > /dev/null 2>&1; then
        print_success "Web interface accessible"
    else
        print_warning "Web interface test failed"
    fi
    
    print_success "Deployment testing completed"
    return 0
}

# Show completion summary
show_completion_summary() {
    print_section "SETUP COMPLETE" 
    
    echo -e "${GREEN}[SUCCESS] OSRM Service is now fully deployed and ready!${NC}"
    echo ""
    echo -e "${CYAN}Available Services:${NC}"
    echo -e "${NC}   * API Server:     http://localhost:8080${NC}"
    echo -e "${NC}   * OSRM Backend:   http://localhost:5000${NC}"
    echo -e "${NC}   * Web Interface:  http://localhost:8080${NC}"
    echo ""
    echo -e "${CYAN}Management Commands:${NC}"
    echo -e "${NC}   * Start:          ./START.sh${NC}"
    echo -e "${NC}   * Stop:           ./STOP.sh${NC}"
    echo -e "${NC}   * Cache Manager:  ./CACHE-MANAGER.sh${NC}"
    echo -e "${NC}   * Docker Manager: ./DOCKER-MANAGER.sh${NC}"
    echo ""
    echo -e "${CYAN}Next Steps:${NC}"
    echo -e "${NC}   1. Apply docker group (avoid sudo): newgrp docker${NC}"
    echo -e "${NC}   2. Or logout/login to apply group membership${NC}"
    echo -e "${NC}   3. Run cache preload: ./CACHE-MANAGER.sh (option 2)${NC}"
    echo -e "${NC}   4. Test routing: http://localhost:80${NC}"
    echo -e "${NC}   5. Monitor with: docker-compose logs -f${NC}"
    echo ""
    echo -e "${YELLOW}For production deployment, see PRODUCTION.md${NC}"
}

# Main execution
main() {
    print_section "OSRM MASTER SETUP" 
    echo -e "${NC}Complete End-to-End Setup for Linux${NC}"
    echo ""
    echo -e "${CYAN}This script will:${NC}"
    echo -e "${GRAY}  - Install prerequisites (Node.js, Docker)${NC}"
    echo -e "${GRAY}  - Setup environment and dependencies${NC}"
    echo -e "${GRAY}  - Download Java Island OSM data (~800MB)${NC}"
    echo -e "${GRAY}  - Process OSRM routing data (10-20 min)${NC}"
    echo -e "${GRAY}  - Start all services${NC}"
    echo -e "${GRAY}  - Test deployment${NC}"
    echo ""
    
    if [ "$MODE" = "interactive" ]; then
        read -p "Continue with setup? (Y/n): " confirm
        if [ "$confirm" = "n" ] || [ "$confirm" = "N" ]; then
            echo "Setup cancelled."
            exit 0
        fi
    fi
    
    # Execute setup steps
    install_prerequisites || { print_error "Prerequisites installation failed"; exit 1; }
    setup_environment || { print_error "Environment setup failed"; exit 1; }
    download_osm_data || { print_error "OSM data download failed"; exit 1; }
    process_osrm_data || { print_error "OSRM data processing failed"; exit 1; }
    start_services || { print_error "Services startup failed"; exit 1; }
    test_deployment || { print_error "Deployment testing failed"; exit 1; }
    
    show_completion_summary
    
    if [ "$MODE" = "interactive" ]; then
        echo ""
        read -p "Press Enter to start the API server: "
        npm start
    fi
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi