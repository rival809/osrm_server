#!/bin/bash

# Cache Manager - Interactive tool untuk mengelola tile cache

echo "🗂️  OSRM Tile Cache Manager"
echo "=========================="
echo ""

BASE_URL="http://localhost:3000"

# Function to check if server is running
check_server() {
    if curl -s -f "$BASE_URL/" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to get cache stats
get_cache_stats() {
    echo "📊 Cache Statistics:"
    echo "==================="
    if curl -s "$BASE_URL/cache/stats" | jq '.' 2>/dev/null; then
        echo ""
    else
        echo "Failed to retrieve cache stats or jq not installed"
        echo "Raw output:"
        curl -s "$BASE_URL/cache/stats" || echo "Server not responding"
        echo ""
    fi
}

# Function to preload tiles
preload_tiles() {
    echo ""
    echo "📥 Preload Tiles Configuration"
    echo "=============================="
    echo "Enter coordinates for tile preloading:"
    echo ""
    
    read -p "Min Latitude (e.g., -6.3): " minLat
    read -p "Max Latitude (e.g., -6.1): " maxLat
    read -p "Min Longitude (e.g., 106.7): " minLng
    read -p "Max Longitude (e.g., 106.9): " maxLng
    read -p "Min Zoom Level (e.g., 10): " minZoom
    read -p "Max Zoom Level (e.g., 15): " maxZoom
    
    echo ""
    echo "🚀 Starting tile preload..."
    echo "This may take several minutes depending on the area and zoom levels"
    echo ""
    
    curl -X POST "$BASE_URL/cache/preload" \
        -H "Content-Type: application/json" \
        -d "{
            \"bounds\": {
                \"minLat\": $minLat,
                \"maxLat\": $maxLat, 
                \"minLng\": $minLng,
                \"maxLng\": $maxLng
            },
            \"minZoom\": $minZoom,
            \"maxZoom\": $maxZoom
        }" | jq '.' 2>/dev/null || echo "Preload request sent"
    
    echo ""
}

# Function to clean cache
clean_cache() {
    echo ""
    echo "🧹 Cache Cleanup Options"
    echo "========================"
    echo "1. Clean expired tiles only"
    echo "2. Clean all tiles"
    echo "3. Clean old tiles (keep recent)"
    echo ""
    
    read -p "Choose option (1-3): " choice
    
    case $choice in
        1)
            echo "🧹 Cleaning expired tiles..."
            curl -X POST "$BASE_URL/cache/clean" \
                -H "Content-Type: application/json" \
                -d '{"type": "expired"}' | jq '.' 2>/dev/null || echo "Cleanup request sent"
            ;;
        2)
            echo "🧹 Cleaning all tiles..."
            curl -X POST "$BASE_URL/cache/clean" \
                -H "Content-Type: application/json" \
                -d '{"type": "all"}' | jq '.' 2>/dev/null || echo "Cleanup request sent"
            ;;
        3)
            echo "🧹 Cleaning old tiles..."
            curl -X POST "$BASE_URL/cache/clean" \
                -H "Content-Type: application/json" \
                -d '{"type": "old"}' | jq '.' 2>/dev/null || echo "Cleanup request sent"
            ;;
        *)
            echo "Invalid option"
            ;;
    esac
    echo ""
}

# Main menu loop
while true; do
    # Check if server is running
    if ! check_server; then
        echo "❌ API Server not running!"
        echo ""
        echo "Please start the server first:"
        echo "   ./START.sh"
        echo "   or"
        echo "   npm start"
        echo ""
        exit 1
    fi
    
    echo "📋 Main Menu"
    echo "============"
    echo "1. 📊 View cache statistics" 
    echo "2. 📥 Preload tiles"
    echo "3. 🧹 Clean cache"
    echo "4. 🔄 Refresh view"
    echo "5. ❌ Exit"
    echo ""
    
    read -p "Choose option (1-5): " choice
    
    case $choice in
        1)
            echo ""
            get_cache_stats
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        2)
            preload_tiles
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        3)
            clean_cache
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        4)
            clear
            echo "🗂️  OSRM Tile Cache Manager"
            echo "=========================="
            echo ""
            ;;
        5)
            echo ""
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo ""
            echo "❌ Invalid option. Please choose 1-5."
            echo ""
            ;;
    esac
done