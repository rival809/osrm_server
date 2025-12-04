#!/bin/bash

# Quick script to reload Nginx configuration

echo "Reloading Nginx configuration..."

# Restart Nginx container
docker restart osrm-nginx

# Wait for Nginx to start
sleep 3

# Check if Nginx is running
if docker ps | grep -q osrm-nginx; then
    echo "✓ Nginx reloaded successfully"
    
    # Test CORS headers
    echo ""
    echo "Testing CORS headers..."
    curl -I http://localhost/health 2>&1 | grep -i "access-control"
    
    echo ""
    echo "Done!"
else
    echo "✗ Nginx failed to start"
    echo "Checking logs..."
    docker logs osrm-nginx --tail 20
fi
