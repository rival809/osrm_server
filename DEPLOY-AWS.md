# 🚀 Deploy ke AWS Free Tier

## Spesifikasi AWS Free Tier

- **EC2 t2.micro** (1 vCPU, 1GB RAM)
- **30GB Storage** (EBS)
- **750 jam/bulan gratis** (12 bulan pertama)
- **Region**: Pilih yang terdekat (Singapore `ap-southeast-1`)

---

## 📋 Step-by-Step Deployment

### **1. Buat EC2 Instance**

1. **Login ke AWS Console**: https://console.aws.amazon.com
2. **Pilih EC2** dari Services
3. **Launch Instance**:
   - Name: `osrm-service`
   - AMI: **Ubuntu Server 22.04 LTS** (Free tier eligible)
   - Instance type: **t2.micro** (1GB RAM)
   - Key pair: Buat baru atau pilih existing
   - Network:
     - ✅ Allow SSH (port 22)
     - ✅ Allow HTTP (port 80)
     - ✅ Allow Custom TCP (port 8080)
   - Storage: **30GB** gp3 (max free tier)
4. **Launch Instance**

### **2. Connect ke Server**

```powershell
# Download .pem file dari AWS
# Set permission (Windows)
icacls "osrm-key.pem" /inheritance:r
icacls "osrm-key.pem" /grant:r "%username%:R"

# Connect via SSH
ssh -i "osrm-key.pem" ubuntu@<PUBLIC-IP>
```

### **3. Install Docker di Ubuntu**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo apt install docker-compose -y

# Reboot untuk apply perubahan
sudo reboot
```

Tunggu 1-2 menit, lalu connect lagi via SSH.

### **4. Upload Project ke Server**

**Option A: Via Git (Recommended)**

```bash
# Install git
sudo apt install git -y

# Clone project
git clone https://github.com/YOUR-USERNAME/osrm_service.git
cd osrm_service
```

**Option B: Via SCP dari Windows**

```powershell
# Dari local Windows
scp -i "osrm-key.pem" -r d:\Kerja\osrm_service ubuntu@<PUBLIC-IP>:~/
```

### **5. Download & Process OSM Data**

```bash
cd ~/osrm_service

# Create data directory
mkdir -p data

# Download Java OSM data (842MB)
wget https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf \
  -O data/java-latest.osm.pbf

# Process OSRM data (15-20 menit)
echo "⏳ Processing OSRM data (this takes 15-20 minutes)..."

# Extract
docker run -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/java-latest.osm.pbf

# Partition
docker run -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/java-latest.osrm

# Customize
docker run -t -v "${PWD}/data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/java-latest.osrm

echo "✅ OSRM data processing complete!"
```

### **6. Install Node.js Dependencies**

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install project dependencies
npm install
```

### **7. Start Services**

```bash
# Start OSRM backend
docker-compose up -d osrm-backend

# Wait for OSRM to be ready
sleep 5

# Start Node.js server (background)
nohup npm start > server.log 2>&1 &

# Check if running
curl http://localhost:8080/health
```

### **8. Setup sebagai Service (Auto-restart)**

Buat systemd service untuk auto-restart:

```bash
# Buat service file
sudo nano /etc/systemd/system/osrm-tile.service
```

Paste konfigurasi ini:

```ini
[Unit]
Description=OSRM Tile Service
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/osrm_service
ExecStartPre=/usr/bin/docker-compose up -d osrm-backend
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

Environment=NODE_ENV=production
Environment=PORT=8080

StandardOutput=append:/home/ubuntu/osrm_service/server.log
StandardError=append:/home/ubuntu/osrm_service/server.log

[Install]
WantedBy=multi-user.target
```

Save dan enable service:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (auto-start on boot)
sudo systemctl enable osrm-tile

# Start service
sudo systemctl start osrm-tile

# Check status
sudo systemctl status osrm-tile

# View logs
sudo journalctl -u osrm-tile -f
```

### **9. Setup Nginx Reverse Proxy (Optional)**

```bash
# Install Nginx
sudo apt install nginx -y

# Buat config
sudo nano /etc/nginx/sites-available/osrm
```

Paste config ini:

```nginx
server {
    listen 80;
    server_name <PUBLIC-IP-ANDA>;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable dan restart:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/osrm /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

---

## 🧪 Testing

```bash
# Dari server
curl http://localhost:8080/health

# Dari browser/Postman
http://<PUBLIC-IP>:8080/health
http://<PUBLIC-IP>:8080/

# Dengan Nginx
http://<PUBLIC-IP>/health
```

---

## 🔒 Security Best Practices

### **1. Setup Firewall (UFW)**

```bash
# Enable firewall
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP
sudo ufw allow 80/tcp

# Allow app port (jika tidak pakai Nginx)
sudo ufw allow 8080/tcp

# Check status
sudo ufw status
```

### **2. Update Security Group di AWS**

Di AWS Console → EC2 → Security Groups:

- SSH (22) - **Hanya dari IP anda**
- HTTP (80) - **0.0.0.0/0** (semua)
- Custom TCP (8080) - **0.0.0.0/0** (jika tidak pakai Nginx)

### **3. Setup Auto-updates**

```bash
# Install unattended-upgrades
sudo apt install unattended-upgrades -y
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 📊 Monitoring

### **Check Service Status**

```bash
# Service status
sudo systemctl status osrm-tile

# View logs
tail -f ~/osrm_service/server.log

# Docker status
docker ps

# Resource usage
htop  # atau: top
df -h  # disk usage
free -h  # memory usage
```

### **Restart Service**

```bash
# Restart aplikasi
sudo systemctl restart osrm-tile

# Restart Docker container
docker-compose restart osrm-backend
```

---

## 💰 Perkiraan Biaya

### **Gratis (12 bulan pertama)**

- t2.micro: 750 jam/bulan = **$0**
- 30GB storage: **$0**
- Bandwidth: 100GB/bulan = **$0**

### **Setelah Free Tier (bulan ke-13)**

- t2.micro: ~**$8-10/bulan**
- 30GB storage: ~**$3/bulan**
- Bandwidth: ~**$1-5/bulan** (tergantung traffic)
- **Total: ~$12-18/bulan**

### **Tips Hemat**

- Matikan instance kalau tidak dipakai
- Gunakan Reserved Instance (lebih murah 40%)
- Set billing alarm di $10-15

---

## 🎯 Domain & SSL (Optional)

### **1. Domain Gratis**

- Freenom: .tk, .ml, .ga, .cf domains
- DuckDNS: dynamic DNS gratis

### **2. SSL dengan Let's Encrypt**

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx -y

# Generate SSL
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

---

## 🐛 Troubleshooting

### **Service tidak start**

```bash
# Check logs
sudo journalctl -u osrm-tile -n 50

# Check port
sudo netstat -tlnp | grep 8080

# Restart
sudo systemctl restart osrm-tile
```

### **OSRM backend error**

```bash
# Check Docker logs
docker logs osrm-backend

# Restart container
docker-compose restart osrm-backend
```

### **Out of Memory**

```bash
# Check memory
free -h

# Add swap (temporary solution)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### **Disk penuh**

```bash
# Check usage
df -h

# Clean Docker
docker system prune -a

# Clean logs
sudo journalctl --vacuum-time=7d
```

---

## 📝 Maintenance

### **Update Code**

```bash
cd ~/osrm_service
git pull
npm install
sudo systemctl restart osrm-tile
```

### **Backup Data**

```bash
# Backup OSRM files
tar -czf osrm-backup.tar.gz data/*.osrm*

# Upload ke S3 (optional)
aws s3 cp osrm-backup.tar.gz s3://your-bucket/
```

---

## 🚀 Next Steps

1. ✅ Setup domain name
2. ✅ Enable SSL/HTTPS
3. ✅ Setup monitoring (CloudWatch)
4. ✅ Configure auto-scaling (jika traffic tinggi)
5. ✅ Setup backup automation

---

## 📞 Support

Jika ada masalah:

1. Check logs: `tail -f ~/osrm_service/server.log`
2. Check service: `sudo systemctl status osrm-tile`
3. Check Docker: `docker ps` dan `docker logs osrm-backend`
