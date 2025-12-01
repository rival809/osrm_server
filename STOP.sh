#!/bin/bash

# Stop OSRM Service script

echo "🛑 Stopping OSRM Service..."
echo "=========================="

# Stop Docker containers
if docker-compose ps -q > /dev/null 2>&1; then
    echo "📦 Stopping Docker containers..."
    docker-compose down
    echo "✅ Docker containers stopped"
else
    echo "ℹ️  No Docker containers running"
fi

# Stop Node.js processes
echo "🔍 Checking for Node.js processes..."
NODE_PIDS=$(ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}')

if [ -n "$NODE_PIDS" ]; then
    echo "🛑 Stopping Node.js processes..."
    echo "$NODE_PIDS" | xargs kill -TERM 2>/dev/null || true
    sleep 2
    
    # Force kill if still running
    NODE_PIDS=$(ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}')
    if [ -n "$NODE_PIDS" ]; then
        echo "💀 Force killing Node.js processes..."
        echo "$NODE_PIDS" | xargs kill -KILL 2>/dev/null || true
    fi
    echo "✅ Node.js processes stopped"
else
    echo "ℹ️  No Node.js processes found"
fi

echo ""
echo "✅ OSRM Service stopped successfully!"
echo ""
echo "💡 To start again, run:"
echo "   ./START.sh"