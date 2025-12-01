#!/bin/bash

# Cache Manager - Interactive tool untuk mengelola tile cache

echo "🗂️  OSRM Tile Cache Manager"
echo "=========================="
echo ""

BASE_URL="http://3.107.98.189:8080"

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

# Function to preload tiles for Java island
preload_java_tiles() {
    echo ""
    echo "🗺️  Java Island Tile Preload (Direct OSM Download)"
    echo "================================================="
    echo "Predefined bounds for Java island:"
    echo "• Area: Java Island (West to East)"
    echo "• Bounds: 105.0°E to 114.0°E, 8.8°S to 5.9°S"
    echo "• Coverage: ~180,000 km² (Java + Madura)"
    echo "• Method: Direct download from OSM servers → Local cache"
    echo ""
    echo "Zoom level options:"
    echo "1. Light (10-11) - ~2,500 tiles, ~95MB, ~5 min"
    echo "2. Standard (10-12) - ~13,800 tiles, ~520MB, ~15 min"  
    echo "3. Detailed (10-13) - ~65,000 tiles, ~2.5GB, ~45 min"
    echo "4. High Detail (10-14) - ~350K tiles, ~13GB, ~3 hours"
    echo "5. Full Detail (10-15) - ~1.5M tiles, ~60GB, ~12 hours"
    echo "6. Custom zoom range"
    echo ""
    
    read -p "Choose preload option (1-6): " option
    
    # Java island bounds
    minLat=-8.8
    maxLat=-5.9
    minLng=105.0
    maxLng=114.0
    
    case $option in
        1)
            minZoom=10
            maxZoom=11
            echo "Selected: Light preload (zoom 10-11)"
            ;;
        2)
            minZoom=10
            maxZoom=12
            echo "Selected: Standard preload (zoom 10-12)"
            ;;
        3)
            minZoom=10
            maxZoom=13
            echo "Selected: Detailed preload (zoom 10-13)"
            ;;
        4)
            minZoom=10
            maxZoom=14
            echo "Selected: High Detail preload (zoom 10-14)"
            ;;
        5)
            minZoom=10
            maxZoom=15
            echo "Selected: Full Detail preload (zoom 10-15)"
            ;;
        6)
            read -p "Min Zoom Level (e.g., 10): " minZoom
            read -p "Max Zoom Level (e.g., 13): " maxZoom
            echo "Selected: Custom zoom $minZoom-$maxZoom"
            ;;
        *)
            echo "Invalid option. Using standard preload (10-12)."
            minZoom=10
            maxZoom=12
            ;;
    esac
    
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
    
    read -p "Choose option (1-5): " choice
    
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

# Function to monitor progress
monitor_progress() {
    echo ""
    echo "📊 Cache Progress Monitor (Direct OSM Downloads)"
    echo "==============================================="
    echo "Monitoring direct OSM tile downloads and cache storage..."
    echo "Press Ctrl+C to stop monitoring"
    echo ""
    
    # Test connectivity and API response first
    echo "🔍 Testing API connectivity..."
    test_response=$(curl -s "$BASE_URL/cache/stats" 2>/dev/null)
    if [ $? -ne 0 ] || [ -z "$test_response" ]; then
        echo "❌ Cannot connect to $BASE_URL"
        echo "Please check if server is running and accessible"
        return 1
    fi
    
    echo "✅ API accessible"
    echo "Raw API response sample:"
    echo "$test_response" | head -5
    echo ""
    
    # Try to parse with different methods
    if command -v jq >/dev/null 2>&1; then
        echo "Using jq for JSON parsing"
        initial_count=$(echo "$test_response" | jq -r '.totalFiles // .total // .count // 0' 2>/dev/null)
        initial_size=$(echo "$test_response" | jq -r '.totalSize // .size // "Unknown"' 2>/dev/null)
    else
        echo "jq not available, using basic text parsing"
        initial_count=$(echo "$test_response" | grep -o '"totalFiles":[0-9]*' | cut -d: -f2 | head -1)
        initial_size=$(echo "$test_response" | grep -o '"totalSize":"[^"]*"' | cut -d\" -f4 | head -1)
        [ -z "$initial_count" ] && initial_count="0"
        [ -z "$initial_size" ] && initial_size="Unknown"
    fi
    
    echo "Initial: $initial_count tiles, $initial_size"
    echo "----------------------------------------"
    
    while true; do
        # Get current stats
        current_stats=$(curl -s "$BASE_URL/cache/stats" 2>/dev/null)
        if [ $? -eq 0 ] && [ -n "$current_stats" ]; then
            
            # Parse stats with fallback methods
            if command -v jq >/dev/null 2>&1; then
                current_count=$(echo "$current_stats" | jq -r '.totalFiles // .total // .count // 0' 2>/dev/null)
                current_size=$(echo "$current_stats" | jq -r '.totalSize // .size // "Unknown"' 2>/dev/null)
                
                # Show zoom level breakdown
                zoom_breakdown=$(echo "$current_stats" | jq -r '.byZoomLevel // .zoomLevels // empty | to_entries[]? | "  Zoom \(.key): \(.value) tiles"' 2>/dev/null | head -3)
            else
                current_count=$(echo "$current_stats" | grep -o '"totalFiles":[0-9]*' | cut -d: -f2 | head -1)
                current_size=$(echo "$current_stats" | grep -o '"totalSize":"[^"]*"' | cut -d\" -f4 | head -1)
                [ -z "$current_count" ] && current_count="0"
                [ -z "$current_size" ] && current_size="Unknown"
                zoom_breakdown=""
            fi
            
            # Calculate progress
            if [ "$current_count" != "null" ] && [ "$current_count" -ge 0 ] 2>/dev/null; then
                if [ "$initial_count" -ge 0 ] 2>/dev/null; then
                    progress=$((current_count - initial_count))
                    echo "$(date +'%H:%M:%S') | Tiles: $current_count (+$progress) | Size: $current_size"
                else
                    echo "$(date +'%H:%M:%S') | Tiles: $current_count | Size: $current_size"
                fi
            else
                echo "$(date +'%H:%M:%S') | Raw response: $current_stats"
            fi
            
            # Show zoom breakdown if available
            if [ -n "$zoom_breakdown" ]; then
                echo "$zoom_breakdown"
            fi
            echo ""
            
        else
            echo "$(date +'%H:%M:%S') | ❌ Unable to fetch stats from $BASE_URL/cache/stats"
        fi
        
        sleep 3
    done
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
    echo "2. 🗺️  Java Island Preload (Multiple Options)"
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
            preload_java_tiles
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