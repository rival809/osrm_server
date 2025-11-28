# 🚀 Quick Start Guide

## Status Saat Ini

✅ **API Server** - Running di port 8080  
⏳ **Download Data** - Sedang progress (~180MB)  
⏸️ **OSRM Processing** - Menunggu download selesai  
⏸️ **Docker Services** - Belum distart

## Langkah-Langkah

### ✅ 1. Install Dependencies (SELESAI)

```powershell
npm install
```

### ⏳ 2. Download Data OSM (SEDANG BERJALAN)

```powershell
# Otomatis sedang download...
# File: data/java-latest.osm.pbf (~180MB)
```

### ⏸️ 3. Process OSRM Data

```powershell
.\scripts\process-osrm.ps1
```

**Waktu:** ~10-20 menit  
**Fungsi:** Convert PBF → OSRM routing data

### ⏸️ 4. Start Docker Services

```powershell
docker-compose up -d
```

**Services:**

- OSRM Backend (routing engine)
- PostgreSQL + PostGIS (opsional untuk tiles)

### ⏸️ 5. Start API Server

```powershell
npm start
```

atau gunakan:

```powershell
.\START.ps1
```

### ⏸️ 6. Test & Demo

Buka browser: **http://localhost:8080**

## API Endpoints

| Endpoint                               | Status     | Keterangan            |
| -------------------------------------- | ---------- | --------------------- |
| `GET /health`                          | ✅ Working | Health check          |
| `GET /tiles/{z}/{x}/{y}.png`           | ✅ Working | Map tiles (proxy OSM) |
| `GET /route?start=lon,lat&end=lon,lat` | ⏸️ Pending | Perlu OSRM backend    |
| `GET /geocode?q=query`                 | ✅ Working | Search via Nominatim  |

## Mode Operasi

### Development (Rekomendasi)

- **Tiles:** Proxy dari OpenStreetMap
- **Database:** Tidak perlu
- **Setup:** Cepat & mudah

### Production

- **Tiles:** Render dari database
- **Database:** PostgreSQL + PostGIS
- **Setup:** Import data (~1 jam)

## Troubleshooting

### Download Lambat/Gagal

```powershell
# Download manual dari browser:
# https://download.geofabrik.de/asia/indonesia.html
# Pilih "Java" → Simpan ke: data/java-latest.osm.pbf
```

### Docker Error

```powershell
# Pastikan Docker Desktop running
docker ps
```

### OSRM Processing Error

```powershell
# Check Docker
docker --version

# Check file PBF exists
Get-Item data\java-latest.osm.pbf
```

## Next Steps

1. ⏳ **Tunggu download selesai** (~5-10 menit lagi)
2. ⏸️ **Run process OSRM:** `.\scripts\process-osrm.ps1`
3. ⏸️ **Start Docker:** `docker-compose up -d`
4. ⏸️ **Test routing:** Buka http://localhost:8080

---

**📊 Progress:** 2/6 steps complete
