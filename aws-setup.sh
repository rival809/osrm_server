#!/bin/bash

# AWS EC2 Setup Script untuk OSRM Service
# Run this script after SSH into EC2 instance

set -e

echo "🚀 Starting AWS EC2 Setup for OSRM Service..."
echo ""

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
rm get-docker.sh

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
sudo apt install docker-compose -y

# Install Node.js 22
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Git
echo "📦 Installing Git..."
sudo apt install git -y

# Install other tools
echo "📦 Installing additional tools..."
sudo apt install -y htop wget curl nano

echo ""
echo "✅ Basic setup complete!"
echo ""
echo "⚠️  IMPORTANT: You need to LOGOUT and LOGIN again for Docker permissions to take effect"
echo ""
echo "After re-login, run these commands:"
echo "  1. Clone/upload your project"
echo "  2. cd osrm_service"
echo "  3. Download OSM data: wget https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf -O data/java-latest.osm.pbf"
echo "  4. Process OSRM data (see DEPLOY-AWS.md)"
echo "  5. npm install"
echo "  6. docker-compose up -d osrm-backend"
echo "  7. npm start"
echo ""
echo "📖 See DEPLOY-AWS.md for detailed instructions"
