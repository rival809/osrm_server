# OSRM Tile Service - Jawa Barat

Service routing dan tile server untuk wilayah Jawa Barat menggunakan OpenStreetMap data. Service ini dirancang dengan konsep **hybrid**: menyimpan data dalam format vector dan melakukan konversi ke raster PNG saat diminta.

## 🌟 Fitur

- **Routing untuk Mobil**: Endpoint routing menggunakan OSRM backend dengan profil driving
- **Tile Server**: Proxy tiles dari OSM atau render dari database lokal
- **Fokus Regional**: Optimized untuk wilayah Jawa Barat saja
- **Cache System**: Tile caching untuk performa optimal
- **RESTful API**: Easy-to-use REST endpoints
- **Demo UI**: Web interface dengan Leaflet untuk testing

## 🚀 Quick Start

### 1. Install Dependencies

```powershell
npm install
```

✅ **Berhasil!** Semua dependencies terinstall tanpa error.

### 2. Download Data OSM

```powershell
npm run download-pbf
```

File ~500MB untuk Indonesia (termasuk Jawa).

### 3. Process untuk OSRM (Windows)

```powershell
.\scripts\process-osrm.ps1
```

### 4. Start API Server

```powershell
npm start
```

Akses: http://localhost:8080

## 📡 API Endpoints

### Routing

```
GET /route?start=107.6191,-6.9175&end=107.6098,-6.9145
```

### Tiles

```
GET /tiles/{z}/{x}/{y}.png
```

### Geocoding

```
GET /geocode?q=Bandung
```

## 🎯 Mode Operasi

### Mode Proxy (Default)

- Tiles dari OpenStreetMap
- Tidak perlu database
- Cocok untuk development

### Mode Render

- Tiles dari database lokal
- Butuh PostGIS (opsional)
- Set `TILE_MODE=render`

## 📁 Struktur

```
osrm_service/
├── data/          # OSM data & OSRM files
├── cache/         # Tile cache
├── src/           # API server
├── scripts/       # Setup scripts
├── public/        # Demo UI
└── docker-compose.yml
```

## 🐛 Troubleshooting

Lihat README lengkap untuk detail troubleshooting.

---

**🗺️ Jawa Barat • OpenStreetMap 🌍**
