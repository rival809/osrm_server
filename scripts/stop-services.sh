#!/bin/bash

# Stop OSRM services
# Script Bash untuk Linux/Ubuntu

echo "🛑 Stopping OSRM Services..."
echo ""

# Stop Docker containers
echo "🐳 Stopping Docker containers..."
docker-compose down

# Kill Node.js processes
echo "🔪 Stopping Node.js server..."
pkill -f "node src/server.js" || true
pkill -f "npm start" || true

echo ""
echo "✅ All services stopped!"
echo ""
echo "💡 To start again, run: ./scripts/start-services.sh"
