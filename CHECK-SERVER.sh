#!/bin/bash

# Quick Server Diagnostic Script
# Check all services and ports

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  OSRM SERVER DIAGNOSTIC${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check Docker
echo -e "${YELLOW}[1] Docker Status:${NC}"
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker installed${NC}"
    docker --version
else
    echo -e "${RED}✗ Docker not found${NC}"
fi
echo ""

# Check running containers
echo -e "${YELLOW}[2] Running Containers:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Check all containers (including stopped)
echo -e "${YELLOW}[3] All Containers:${NC}"
docker ps -a --format "table {{.Names}}\t{{.Status}}"
echo ""

# Check ports
echo -e "${YELLOW}[4] Port Status:${NC}"

# Port 5000 (OSRM Backend)
if curl -s -f "http://localhost:5000/route/v1/driving/106.8456,-6.2088;106.8894,-6.1753" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Port 5000 (OSRM Backend): WORKING${NC}"
else
    echo -e "${RED}✗ Port 5000 (OSRM Backend): NOT RESPONDING${NC}"
fi

# Port 8080 (API Server)
if curl -s -f "http://localhost:8080/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Port 8080 (API Server): WORKING${NC}"
else
    echo -e "${RED}✗ Port 8080 (API Server): NOT RESPONDING${NC}"
fi

# Port 80 (Nginx)
if curl -s -f "http://localhost/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Port 80 (Nginx): WORKING${NC}"
else
    echo -e "${RED}✗ Port 80 (Nginx): NOT RESPONDING${NC}"
fi
echo ""

# Check OSRM files
echo -e "${YELLOW}[5] OSRM Data Files:${NC}"
if [ -f "data/java-latest.osrm.mldgr" ]; then
    echo -e "${GREEN}✓ OSRM files exist${NC}"
    echo "   $(ls -lh data/java-latest.osrm* | wc -l) files found"
else
    echo -e "${RED}✗ OSRM files missing${NC}"
fi
echo ""

# Recent logs
echo -e "${YELLOW}[6] Recent Container Logs:${NC}"
echo ""
echo -e "${CYAN}--- OSRM Backend (last 10 lines) ---${NC}"
docker logs osrm-backend --tail 10 2>&1 | sed 's/^/  /'
echo ""
echo -e "${CYAN}--- API Server (last 10 lines) ---${NC}"
docker logs osrm-api-1 --tail 10 2>&1 | sed 's/^/  /'
echo ""
echo -e "${CYAN}--- Nginx (last 10 lines) ---${NC}"
docker logs osrm-nginx --tail 10 2>&1 | sed 's/^/  /'
echo ""

# Network connectivity
echo -e "${YELLOW}[7] External Access Test:${NC}"
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
echo "   Public IP: $PUBLIC_IP"
echo "   Test URL: http://$PUBLIC_IP/"
echo ""

# Security Group reminder
echo -e "${YELLOW}[8] AWS Security Group Check:${NC}"
echo "   Make sure these ports are open in AWS Security Group:"
echo "   - Port 80 (HTTP) - 0.0.0.0/0"
echo "   - Port 443 (HTTPS) - 0.0.0.0/0"
echo "   - Port 22 (SSH) - Your IP"
echo ""

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Diagnostic Complete${NC}"
echo -e "${CYAN}========================================${NC}"
