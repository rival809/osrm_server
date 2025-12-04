#!/bin/bash

# Quick Fix Script - Restart all services properly
# Use this when services are not responding

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  OSRM QUICK FIX${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Stop all services
echo -e "${YELLOW}[1] Stopping all services...${NC}"
docker-compose down
sleep 3
echo -e "${GREEN}✓ Services stopped${NC}"
echo ""

# Clean up (optional - uncomment if needed)
# echo -e "${YELLOW}[2] Cleaning up old containers...${NC}"
# docker system prune -f
# echo -e "${GREEN}✓ Cleanup complete${NC}"
# echo ""

# Start all services
echo -e "${YELLOW}[2] Starting all services...${NC}"
docker-compose up --build -d
echo -e "${GREEN}✓ Services started${NC}"
echo ""

# Wait for startup
echo -e "${YELLOW}[3] Waiting for services to initialize (20 seconds)...${NC}"
for i in {20..1}; do
    echo -ne "   ${CYAN}$i seconds remaining...${NC}\r"
    sleep 1
done
echo -e "   ${GREEN}✓ Wait complete${NC}                    "
echo ""

# Check status
echo -e "${YELLOW}[4] Checking container status...${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Test endpoints
echo -e "${YELLOW}[5] Testing endpoints...${NC}"

# OSRM Backend
echo -n "   Port 5000 (OSRM Backend): "
if curl -s -f "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ WORKING${NC}"
else
    echo -e "${RED}✗ NOT RESPONDING${NC}"
fi

# API Server
echo -n "   Port 8080 (API Server): "
if curl -s -f "http://localhost:8080/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ WORKING${NC}"
else
    echo -e "${RED}✗ NOT RESPONDING${NC}"
fi

# Nginx
echo -n "   Port 80 (Nginx): "
if curl -s -f "http://localhost/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ WORKING${NC}"
else
    echo -e "${RED}✗ NOT RESPONDING${NC}"
fi
echo ""

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  Services restarted!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "Test URLs:"
echo -e "  Local:  ${CYAN}http://localhost/${NC}"
echo -e "  Public: ${CYAN}http://$PUBLIC_IP/${NC}"
echo ""
echo -e "${YELLOW}Note: If public URL doesn't work, check AWS Security Group!${NC}"
echo ""
