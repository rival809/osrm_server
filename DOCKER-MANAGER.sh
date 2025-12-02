#!/bin/bash

# OSRM Docker Management Script
# Menjalankan OSRM Backend + Tile Cache Service dalam Docker

echo "🐳 OSRM Docker Management"
echo "========================="
echo ""

# Function to show menu
show_docker_menu() {
    echo "Docker Services:"
    echo "1. Start All Services (OSRM + Tile Cache)"
    echo "2. Stop All Services"
    echo "3. Restart Services"
    echo "4. View Logs (Tile Cache)"
    echo "5. View Logs (OSRM Backend)"
    echo "6. Service Status"
    echo "7. Build/Rebuild Images"
    echo "8. Clean Docker Cache"
    echo "9. Exit"
    echo ""
}

# Function to start services
start_docker_services() {
    echo "🚀 Starting Docker services..."
    docker-compose up -d
    
    if [ $? -eq 0 ]; then
        echo "✅ Services started successfully!"
        echo ""
        echo "Services available at:"
        echo "• OSRM Backend: http://localhost:5000"
        echo "• Tile Cache Service: http://localhost:3000"
        echo "• Cache Manager: Access via http://localhost:3000/cache/stats"
        echo ""
        
        # Wait for services to be ready
        echo "⏳ Waiting for services to be ready..."
        sleep 10
        
        # Test connectivity
        if curl -f http://localhost:3000/health >/dev/null 2>&1; then
            echo "✅ Tile Cache Service is healthy"
        else
            echo "⚠️  Tile Cache Service may still be starting..."
        fi
    else
        echo "❌ Failed to start services"
    fi
}

# Function to stop services
stop_docker_services() {
    echo "🛑 Stopping Docker services..."
    docker-compose down
    
    if [ $? -eq 0 ]; then
        echo "✅ Services stopped successfully!"
    else
        echo "❌ Failed to stop services"
    fi
}

# Function to restart services
restart_docker_services() {
    echo "🔄 Restarting Docker services..."
    docker-compose restart
    
    if [ $? -eq 0 ]; then
        echo "✅ Services restarted successfully!"
    else
        echo "❌ Failed to restart services"
    fi
}

# Function to show logs
show_tile_cache_logs() {
    echo "📋 Tile Cache Service Logs (Press Ctrl+C to exit)"
    docker-compose logs -f tile-cache
}

show_osrm_logs() {
    echo "📋 OSRM Backend Logs (Press Ctrl+C to exit)"
    docker-compose logs -f osrm-backend
}

# Function to show status
show_service_status() {
    echo "📊 Service Status"
    echo "================="
    docker-compose ps
    echo ""
    
    # Show resource usage
    echo "💾 Resource Usage"
    echo "================="
    docker stats --no-stream osrm-backend osrm-tile-cache 2>/dev/null || echo "Services may not be running"
}

# Function to build images
build_docker_images() {
    echo "🔨 Building Docker images..."
    docker-compose build --no-cache
    
    if [ $? -eq 0 ]; then
        echo "✅ Images built successfully!"
    else
        echo "❌ Failed to build images"
    fi
}

# Function to clean Docker cache
clean_docker_cache() {
    echo "🧹 Cleaning Docker cache..."
    echo "This will remove unused images, containers, and networks."
    read -p "Continue? (y/N): " confirm
    
    if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
        docker system prune -f
        docker image prune -f
        echo "✅ Docker cache cleaned!"
    else
        echo "❌ Cancelled"
    fi
}

# Main loop
while true; do
    show_docker_menu
    read -p "Select option (1-9): " choice
    
    case $choice in
        1) start_docker_services ;;
        2) stop_docker_services ;;
        3) restart_docker_services ;;
        4) show_tile_cache_logs ;;
        5) show_osrm_logs ;;
        6) show_service_status ;;
        7) build_docker_images ;;
        8) clean_docker_cache ;;
        9) 
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "❌ Invalid option. Please select 1-9."
            ;;
    esac
    
    if [ "$choice" != "9" ]; then
        echo ""
        read -p "Press Enter to continue..."
        clear
    fi
done