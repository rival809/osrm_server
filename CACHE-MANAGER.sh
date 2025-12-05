#!/bin/bash

# ========================================================================
# OSRM Tile Cache Manager v2.0 - Enhanced with Resume Download Support  
# ========================================================================
#
# Features:
# ✅ Resume Download: Skip completed files, continue partial downloads
# ✅ Smart Caching: MD5-based file naming prevents duplicates
# ✅ Metadata Tracking: JSON metadata for each download with completion status
# ✅ Batch Processing: Concurrent downloads with retry logic
# ✅ Progress Monitoring: Real-time stats and progress tracking
# ✅ Error Recovery: Automatic retry with exponential backoff
# ✅ Cache Validation: Integrity checks and cleanup utilities

echo "🗂️  OSRM Tile Cache Manager v2.0"
echo "with Resume Download Support"
echo "================================"
echo ""

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v bc >/dev/null 2>&1; then
        missing_deps+=("bc")
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        echo "❌ Missing dependencies: ${missing_deps[*]}"
        echo ""
        echo "Please install missing dependencies:"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        echo "  CentOS/RHEL: sudo yum install ${missing_deps[*]}"
        echo "  MacOS: brew install ${missing_deps[*]}"
        echo ""
        exit 1
    fi
}

# Check dependencies first
check_dependencies

# Auto-detect if running on same server as OSRM
if curl -s -f --connect-timeout 2 --max-time 3 "http://localhost/health" > /dev/null 2>&1; then
    BASE_URL="http://localhost"
    echo "✅ Detected local OSRM server"
elif curl -s -f --connect-timeout 2 --max-time 3 "http://localhost:8080/health" > /dev/null 2>&1; then
    BASE_URL="http://localhost:8080"
    echo "✅ Detected local OSRM server on port 8080"
else
    BASE_URL="http://3.107.98.189:8080"
    echo "⚠️  Using remote OSRM server: $BASE_URL"
fi

CACHE_DIR="./cache"
METADATA_DIR="./cache/.metadata"

# Initialize cache directories
initialize_cache_dirs() {
    mkdir -p "$CACHE_DIR"
    mkdir -p "$METADATA_DIR"
}

# Function to generate cache key from URL
get_cache_key() {
    echo -n "$1" | md5sum | cut -d' ' -f1
}

# Function to get cache file path
get_cache_file_path() {
    local url="$1"
    local key=$(get_cache_key "$url")
    local subdir="${key:0:2}"
    local cache_subdir="$CACHE_DIR/$subdir"
    
    mkdir -p "$cache_subdir"
    echo "$cache_subdir/$key.tile"
}

# Function to get metadata file path
get_metadata_path() {
    local url="$1"
    local key=$(get_cache_key "$url")
    echo "$METADATA_DIR/$key.json"
}

# Function to check if file is complete (optimized)
is_file_complete() {
    local url="$1"
    local cache_file=$(get_cache_file_path "$url")
    local meta_file=$(get_metadata_path "$url")
    
    # Quick check - if cache file doesn't exist, return false immediately
    if [[ ! -f "$cache_file" ]]; then
        return 1
    fi
    
    # Quick check - if metadata doesn't exist, return false immediately
    if [[ ! -f "$meta_file" ]]; then
        return 1
    fi
    
    # Quick grep check instead of jq (faster for simple check)
    if grep -q '"completed":true' "$meta_file" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to download with resume support
download_with_resume() {
    local url="$1"
    local timeout="${2:-30}"
    local max_retries="${3:-3}"
    
    initialize_cache_dirs
    
    local cache_file=$(get_cache_file_path "$url")
    local meta_file=$(get_metadata_path "$url")
    
    # Check if file is already complete
    if is_file_complete "$url"; then
        echo "✅ File already complete, skipping: $(basename "$cache_file")"
        return 0
    fi
    
    # Get current file size for resume
    local current_size=0
    if [[ -f "$cache_file" ]]; then
        current_size=$(stat -c%s "$cache_file" 2>/dev/null || echo 0)
    fi
    
    for ((retry=0; retry<=max_retries; retry++)); do
        if [[ $retry -gt 0 ]]; then
            echo "🔄 Retry $retry/$max_retries for: $(basename "$cache_file")"
            sleep $((2 * retry)) # Exponential backoff
        fi
        
        # Prepare headers for resume
        local range_header=""
        if [[ $current_size -gt 0 ]]; then
            range_header="-H Range:bytes=$current_size-"
            echo "📄 Resuming download from byte $current_size"
        fi
        
        # Download with resume support
        if curl -s --connect-timeout "$timeout" --max-time "$timeout" \
               $range_header "$url" -o "$cache_file.tmp" --write-out "%{http_code}" > /tmp/curl_status; then
            
            local http_code=$(cat /tmp/curl_status)
            rm -f /tmp/curl_status
            
            if [[ "$http_code" == "200" ]] || [[ "$http_code" == "206" ]]; then
                # Successful download
                if [[ $current_size -gt 0 ]] && [[ "$http_code" == "206" ]]; then
                    # Append to existing file for resume
                    cat "$cache_file.tmp" >> "$cache_file"
                    rm -f "$cache_file.tmp"
                    echo "📄 Resumed download: $(basename "$cache_file")"
                else
                    # New download
                    mv "$cache_file.tmp" "$cache_file"
                    echo "📄 New download: $(basename "$cache_file")"
                fi
                
                # Update metadata
                local file_size=$(stat -c%s "$cache_file")
                cat > "$meta_file" << EOF
{
  "url": "$url",
  "size": $file_size,
  "completed": true,
  "endTime": "$(date -Iseconds)"
}
EOF
                echo "✅ Download completed: $(basename "$cache_file")"
                return 0
                
            elif [[ "$http_code" == "416" ]]; then
                # Range not satisfiable - file might be complete
                rm -f "$cache_file.tmp"
                echo "✅ File appears to be already complete"
                cat > "$meta_file" << EOF
{
  "url": "$url",
  "completed": true,
  "endTime": "$(date -Iseconds)"
}
EOF
                return 0
            fi
        fi
        
        rm -f "$cache_file.tmp"
        
        if [[ $retry -eq $max_retries ]]; then
            echo "❌ Download failed after $max_retries retries"
            return 1
        fi
    done
}

# Function to check if server is running (optional)
check_server() {
    if curl -s -f --connect-timeout 3 --max-time 5 "$BASE_URL/health" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to get local cache stats
get_local_cache_stats() {
    echo "📊 Local Cache Statistics:"
    echo "========================="
    echo "Cache Directory: $CACHE_DIR"
    echo "Metadata Directory: $METADATA_DIR"
    echo ""
    
    local total_files=0
    local completed_files=0
    local incomplete_files=0
    local total_size=0
    
    if [[ -d "$CACHE_DIR" ]]; then
        while IFS= read -r -d '' file; do
            if [[ -f "$file" ]] && [[ "$file" == *.tile ]]; then
                total_files=$((total_files + 1))
                local file_size=$(stat -c%s "$file" 2>/dev/null || echo 0)
                total_size=$((total_size + file_size))
                
                # Check if file is complete
                local basename_file=$(basename "$file" .tile)
                local meta_file="$METADATA_DIR/$basename_file.json"
                
                if [[ -f "$meta_file" ]]; then
                    local completed=$(jq -r '.completed // false' "$meta_file" 2>/dev/null)
                    if [[ "$completed" == "true" ]]; then
                        completed_files=$((completed_files + 1))
                    else
                        incomplete_files=$((incomplete_files + 1))
                    fi
                else
                    incomplete_files=$((incomplete_files + 1))
                fi
            fi
        done < <(find "$CACHE_DIR" -name "*.tile" -print0 2>/dev/null)
    fi
    
    # Format file size
    local size_formatted
    if [[ $total_size -gt 1073741824 ]]; then
        size_formatted="$(echo "scale=2; $total_size / 1073741824" | bc -l) GB"
    elif [[ $total_size -gt 1048576 ]]; then
        size_formatted="$(echo "scale=2; $total_size / 1048576" | bc -l) MB"
    elif [[ $total_size -gt 1024 ]]; then
        size_formatted="$(echo "scale=2; $total_size / 1024" | bc -l) KB"
    else
        size_formatted="$total_size Bytes"
    fi
    
    echo "📊 File Statistics:"
    echo "  Total Files: $total_files"
    echo "  ✅ Completed: $completed_files"
    echo "  ⏸️  Incomplete: $incomplete_files"
    echo "  💾 Total Size: $size_formatted"
    echo ""
}

# Function to get cache stats (combines local and server)
get_cache_stats() {
    get_local_cache_stats
    
    # Try to get server stats if available
    if check_server; then
        echo "📊 Server Cache Statistics:"
        echo "=========================="
        if curl -s "$BASE_URL/cache/stats" | jq '.' 2>/dev/null; then
            echo ""
        else
            echo "Server stats format not supported"
            echo ""
        fi
    else
        echo "Server cache stats not available (server offline)"
        echo ""
    fi
}

# Function to generate tile URLs for given bounds and zoom levels
generate_tile_urls() {
    local minLat=$1 maxLat=$2 minLng=$3 maxLng=$4
    shift 4
    local zoom_levels=("$@")
    local urls=()
    local tile_server="$BASE_URL/tiles"
    
    for zoom in "${zoom_levels[@]}"; do
        # Calculate tile bounds for this zoom level using bc for floating point math
        local minX=$(echo "($minLng + 180.0) / 360.0 * (2^$zoom)" | bc -l | cut -d. -f1)
        local maxX=$(echo "($maxLng + 180.0) / 360.0 * (2^$zoom)" | bc -l | cut -d. -f1)
        
        # For Y coordinates, we need more complex math
        local minY_calc=$(echo "scale=10; lat=$maxLat*3.14159/180; (1 - (l(s(lat/2) + 1/c(lat/2))/3.14159))/2 * 2^$zoom" | bc -l)
        local maxY_calc=$(echo "scale=10; lat=$minLat*3.14159/180; (1 - (l(s(lat/2) + 1/c(lat/2))/3.14159))/2 * 2^$zoom" | bc -l)
        local minY=$(echo "$minY_calc" | cut -d. -f1)
        local maxY=$(echo "$maxY_calc" | cut -d. -f1)
        
        local tile_count=$(((maxX-minX+1)*(maxY-minY+1)))
        echo "Zoom $zoom: tiles X($minX-$maxX) Y($minY-$maxY) = $tile_count tiles"
        
        for ((x=minX; x<=maxX; x++)); do
            for ((y=minY; y<=maxY; y++)); do
                urls+=("$tile_server/$zoom/$x/$y.png")
            done
        done
    done
    
    printf '%s\n' "${urls[@]}"
}

# Function to preload Java island tiles with resume support
preload_java_tiles() {
    echo ""
    echo "🗺️  Java Island Tile Preload with Resume Download"
    echo "================================================="
    echo "Predefined bounds for Java island:"
    echo "• Area: Java Island (West to East)"
    echo "• Bounds: 105.0°E to 114.0°E, 8.8°S to 5.9°S"
    echo "• Coverage: ~180,000 km² (Java + Madura)"
    echo "• Method: Direct download from OSM servers with Resume Support"
    echo "• Resume: Skips completed files, resumes partial downloads"
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
    local minLat=-8.8 maxLat=-5.9 minLng=105.0 maxLng=114.0
    local zoom_levels=()
    
    case $option in
        1)
            zoom_levels=(10 11)
            echo "Selected: Light preload (zoom 10-11)"
            ;;
        2)
            zoom_levels=(10 11 12)
            echo "Selected: Standard preload (zoom 10-12)"
            ;;
        3)
            zoom_levels=(10 11 12 13)
            echo "Selected: Detailed preload (zoom 10-13)"
            ;;
        4)
            zoom_levels=(10 11 12 13 14)
            echo "Selected: High Detail preload (zoom 10-14)"
            ;;
        5)
            zoom_levels=(10 11 12 13 14 15)
            echo "Selected: Full Detail preload (zoom 10-15)"
            ;;
        6)
            read -p "Min Zoom Level (e.g., 10): " minZoom
            read -p "Max Zoom Level (e.g., 13): " maxZoom
            zoom_levels=($(seq $minZoom $maxZoom))
            echo "Selected: Custom zoom $minZoom-$maxZoom"
            ;;
        *)
            echo "Invalid option. Using standard preload (10-12)."
            zoom_levels=(10 11 12)
            ;;
    esac
    
    echo ""
    echo "🚀 Starting Java tile preload with resume support..."
    echo "Zoom levels: ${zoom_levels[*]}"
    echo "Area: Java Island, Indonesia"
    echo ""
    
    # Generate tile URLs
    echo "🔗 Generating tile URLs..."
    local tile_urls=($(generate_tile_urls $minLat $maxLat $minLng $maxLng "${zoom_levels[@]}"))
    
    echo "📊 Generated ${#tile_urls[@]} tile URLs"
    
    # Give user option to skip checking if they have many files
    if [[ ${#tile_urls[@]} -gt 10000 ]]; then
        echo ""
        echo "⚠️  Large number of URLs detected (${#tile_urls[@]} tiles)"
        echo "🔍 Checking existing downloads may take several minutes..."
        echo ""
        echo "Options:"
        echo "1. Check existing files first (recommended, but slower)"
        echo "2. Skip checking and download all (faster start, but may re-download)"
        echo ""
        read -p "Choose option (1 or 2): " check_option
        
        if [[ "$check_option" == "2" ]]; then
            echo "⚡ Skipping file check, will rely on resume download logic..."
            pending_urls=("${tile_urls[@]}")
            completed_count=0
        else
            echo "🔍 Checking existing downloads..."
            echo "📊 Total URLs to check: ${#tile_urls[@]}"
            
            local completed_count=0
            local pending_urls=()
            local check_count=0
            
            # Show progress every 500 checks for large sets
            for url in "${tile_urls[@]}"; do
                ((check_count++))
                if [[ $((check_count % 500)) -eq 0 ]]; then
                    local progress=$(echo "scale=1; $check_count * 100 / ${#tile_urls[@]}" | bc -l)
                    echo "🔍 Checking progress: [$progress%] $check_count/${#tile_urls[@]}"
                fi
                
                if is_file_complete "$url"; then
                    ((completed_count++))
                else
                    pending_urls+=("$url")
                fi
            done
        fi
    else
        # For smaller sets, always check
        echo "🔍 Checking existing downloads..."
        
        local completed_count=0
        local pending_urls=()
        local check_count=0
        
        for url in "${tile_urls[@]}"; do
            ((check_count++))
            if [[ $((check_count % 1000)) -eq 0 ]]; then
                local progress=$(echo "scale=1; $check_count * 100 / ${#tile_urls[@]}" | bc -l)
                echo "🔍 Checking progress: [$progress%] $check_count/${#tile_urls[@]}"
            fi
            
            if is_file_complete "$url"; then
                ((completed_count++))
            else
                pending_urls+=("$url")
            fi
        done
    fi
    
    echo "✅ Already completed: $completed_count tiles"
    echo "📥 Need to download: ${#pending_urls[@]} tiles"
    
    if [[ ${#pending_urls[@]} -eq 0 ]]; then
        echo "🎉 All tiles already downloaded! Nothing to do."
        return
    fi
    
    echo "⚙️ Concurrency: 5 simultaneous downloads"
    echo "🔄 Retry policy: 3 attempts per tile with backoff"
    echo "📁 Cache location: $CACHE_DIR"
    echo ""
    
    read -p "Continue with downloading ${#pending_urls[@]} remaining tiles? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Download cancelled."
        return
    fi
    
    # Start batch download with resume
    echo "🚀 Starting batch download..."
    local start_time=$(date +%s)
    local successful=0
    local failed=0
    local processed=0
    
    # Process URLs in batches of 5 (concurrent downloads)
    for ((i=0; i<${#pending_urls[@]}; i+=5)); do
        local batch=("${pending_urls[@]:i:5}")
        local pids=()
        
        # Start concurrent downloads
        for url in "${batch[@]}"; do
            (
                if download_with_resume "$url" 30 3; then
                    echo "SUCCESS: $url"
                else
                    echo "FAILED: $url"
                fi
            ) &
            pids+=($!)
        done
        
        # Wait for batch to complete
        for pid in "${pids[@]}"; do
            wait $pid
            local exit_code=$?
            ((processed++))
            if [[ $exit_code -eq 0 ]]; then
                ((successful++))
            else
                ((failed++))
            fi
            
            local progress=$(echo "scale=1; $processed * 100 / ${#pending_urls[@]}" | bc -l)
            echo "[$progress%] Progress: $processed/${#pending_urls[@]}"
        done
    done
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local hours=$((duration / 3600))
    local minutes=$(((duration % 3600) / 60))
    local seconds=$((duration % 60))
    
    echo ""
    echo "🎉 Java tile preload completed!"
    echo "✅ New downloads: $successful"
    echo "✅ Already had: $completed_count"
    echo "✅ Total tiles: $((completed_count + successful))"
    echo "❌ Failed downloads: $failed"
    printf "⏱️ Download time: %02d:%02d:%02d\n" $hours $minutes $seconds
    echo "📁 Files saved to: $CACHE_DIR"
    echo ""
    
    if [[ $failed -gt 0 ]]; then
        echo "❗ Some downloads failed. You can re-run this command to retry failed downloads."
    fi
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

# Function to clean incomplete downloads
clean_incomplete_downloads() {
    echo ""
    echo "🧹 Clean Incomplete Downloads"
    echo "============================="
    echo "This will remove partial downloads and corrupted metadata files."
    echo ""
    
    initialize_cache_dirs
    
    local cleaned=0
    
    echo "🔍 Scanning metadata files..."
    
    if [[ -d "$METADATA_DIR" ]]; then
        for meta_file in "$METADATA_DIR"/*.json; do
            [[ -f "$meta_file" ]] || continue
            
            local basename_file=$(basename "$meta_file" .json)
            local cache_file
            
            # Find corresponding cache file
            for cache_subdir in "$CACHE_DIR"/*; do
                [[ -d "$cache_subdir" ]] || continue
                local potential_cache="$cache_subdir/$basename_file.tile"
                if [[ -f "$potential_cache" ]]; then
                    cache_file="$potential_cache"
                    break
                fi
            done
            
            local should_clean=false
            local reason=""
            
            # Check metadata
            if ! jq -e . "$meta_file" >/dev/null 2>&1; then
                should_clean=true
                reason="Invalid metadata"
            else
                local completed=$(jq -r '.completed // false' "$meta_file" 2>/dev/null)
                if [[ "$completed" != "true" ]]; then
                    should_clean=true
                    reason="Incomplete download"
                elif [[ ! -f "$cache_file" ]]; then
                    should_clean=true
                    reason="Missing cache file"
                fi
            fi
            
            if [[ "$should_clean" == "true" ]]; then
                echo "  • $reason: $(basename "$meta_file")"
                ((cleaned++))
            fi
        done
    fi
    
    if [[ $cleaned -eq 0 ]]; then
        echo "✅ No incomplete downloads found. All cached files appear to be complete."
        return
    fi
    
    echo ""
    echo "🗑️ Found $cleaned incomplete/corrupted downloads"
    echo "WARNING: This will delete incomplete files and their metadata!"
    read -p "Proceed with cleanup? (y/N): " confirm
    
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Cleanup cancelled."
        return
    fi
    
    echo ""
    echo "🧹 Cleaning incomplete downloads..."
    
    local deleted_count=0
    for meta_file in "$METADATA_DIR"/*.json; do
        [[ -f "$meta_file" ]] || continue
        
        local basename_file=$(basename "$meta_file" .json)
        local cache_file
        
        # Find corresponding cache file
        for cache_subdir in "$CACHE_DIR"/*; do
            [[ -d "$cache_subdir" ]] || continue
            local potential_cache="$cache_subdir/$basename_file.tile"
            if [[ -f "$potential_cache" ]]; then
                cache_file="$potential_cache"
                break
            fi
        done
        
        local should_clean=false
        if ! jq -e . "$meta_file" >/dev/null 2>&1; then
            should_clean=true
        else
            local completed=$(jq -r '.completed // false' "$meta_file" 2>/dev/null)
            if [[ "$completed" != "true" ]] || [[ ! -f "$cache_file" ]]; then
                should_clean=true
            fi
        fi
        
        if [[ "$should_clean" == "true" ]]; then
            rm -f "$meta_file"
            [[ -f "$cache_file" ]] && rm -f "$cache_file"
            echo "  🗑️ Removed: $(basename "$meta_file")"
            ((deleted_count++))
        fi
    done
    
    echo ""
    echo "✅ Cleanup completed!"
    echo "🗑️ Removed $deleted_count incomplete downloads"
    echo "💡 You can now re-run the download to retry these files"
    echo ""
}

# Main menu loop
while true; do
    echo "=========================================="
    echo "    OSRM Tile Cache Manager v2.0        "
    echo "   with Resume Download Support          "
    echo "=========================================="
    echo ""
    
    # Show server status (optional)
    if check_server; then
        echo "Server Status: ✅ Running ($BASE_URL)"
    else
        echo "Server Status: ❌ Offline (but cache manager works independently)"
    fi
    echo ""
    
    echo "📋 Main Menu"
    echo "============"
    echo "1. 📊 View cache statistics (Local + Server)"
    echo "2. 🗺️  Java Island Preload (Resume Support)" 
    echo "3. 🧹 Clean incomplete downloads"
    echo "4. 🔄 Refresh view"
    echo "5. ❌ Exit"
    echo ""
    echo "✨ New: Resume download skips completed files and continues partial downloads"
    echo ""
    
    read -p "Choose option (1-5): " choice
    
    case $choice in
        1)
            # Cache statistics - works offline
            echo ""
            get_cache_stats
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        2)
            # Java Island Preload with Resume - works offline
            preload_java_tiles
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        3)
            # Clean incomplete downloads - works offline
            clean_incomplete_downloads
            echo "Press any key to continue..."
            read -n 1 -s
            echo ""
            ;;
        4)
            clear
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