#!/bin/bash

# Quick Docker Commands untuk OSRM Service
# Shortcut commands untuk management yang lebih mudah

echo "🐳 OSRM Docker Quick Commands"
echo "=============================="

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose not found. Please install Docker and Docker Compose first."
    exit 1
fi

case "${1:-help}" in
    "start"|"up")
        echo "🚀 Starting OSRM services..."
        docker-compose up -d
        echo ""
        echo "Services are starting up. Check status with: $0 status"
        echo "• Tile Cache: http://localhost:3000"
        echo "• OSRM Backend: http://localhost:5000"
        ;;
    
    "stop"|"down")
        echo "🛑 Stopping OSRM services..."
        docker-compose down
        ;;
    
    "restart")
        echo "🔄 Restarting OSRM services..."
        docker-compose restart
        ;;
    
    "status"|"ps")
        echo "📊 Service Status:"
        docker-compose ps
        echo ""
        echo "💾 Resource Usage:"
        docker stats --no-stream osrm-backend osrm-tile-cache 2>/dev/null || echo "Services not running"
        ;;
    
    "logs")
        service=${2:-tile-cache}
        echo "📋 Showing logs for: $service"
        echo "Press Ctrl+C to exit"
        docker-compose logs -f $service
        ;;
    
    "build")
        echo "🔨 Building Docker images..."
        docker-compose build --no-cache
        ;;
    
    "cache")
        echo "📊 Cache Statistics:"
        if curl -s http://localhost:3000/cache/stats > /dev/null 2>&1; then
            curl -s http://localhost:3000/cache/stats | jq '.' 2>/dev/null || curl -s http://localhost:3000/cache/stats
        else
            echo "❌ Tile cache service not accessible. Is it running?"
        fi
        ;;
    
    "preload")
        echo "🔄 Starting tile preload for Java island..."
        if curl -s http://localhost:3000/health > /dev/null 2>&1; then
            curl -X POST http://localhost:3000/cache/preload \
                -H "Content-Type: application/json" \
                -d '{"zoomLevels": [10, 11, 12, 13]}' | jq '.' 2>/dev/null
        else
            echo "❌ Tile cache service not accessible. Start services first with: $0 start"
        fi
        ;;
    
    "clean")
        echo "🧹 Cleaning Docker resources..."
        echo "This will remove stopped containers and unused images"
        read -p "Continue? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker system prune -f
            echo "✅ Cleanup completed"
        fi
        ;;
    
    "health")
        echo "🏥 Health Check:"
        echo "Testing services..."
        
        # Test tile cache
        if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
            echo "✅ Tile Cache Service: Healthy"
        else
            echo "❌ Tile Cache Service: Not accessible"
        fi
        
        # Test OSRM
        if curl -sf http://localhost:5000/health > /dev/null 2>&1; then
            echo "✅ OSRM Backend: Healthy"
        else
            echo "❌ OSRM Backend: Not accessible"
        fi
        ;;
    
    "help"|*)
        echo "Usage: $0 [command]"
        echo ""
        echo "Available commands:"
        echo "  start, up      - Start all services"
        echo "  stop, down     - Stop all services"  
        echo "  restart        - Restart all services"
        echo "  status, ps     - Show service status"
        echo "  logs [service] - Show logs (default: tile-cache)"
        echo "  build          - Rebuild Docker images"
        echo "  cache          - Show cache statistics"
        echo "  preload        - Start tile preload"
        echo "  clean          - Clean Docker resources"
        echo "  health         - Check service health"
        echo "  help           - Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 start       # Start all services"
        echo "  $0 logs        # Show tile-cache logs"
        echo "  $0 logs osrm-backend  # Show OSRM logs"
        echo "  $0 cache       # Show cache stats"
        ;;
esac