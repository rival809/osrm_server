# Setup Guide - OSRM Tile Service

## ✅ Status Installation

**Dependencies:** ✅ Berhasil terinstall
**API Server:** ✅ Berjalan di port 8080
**Mode:** Proxy (tiles dari OpenStreetMap)

## 📝 Langkah Selanjutnya

### Option 1: Development Mode (Cepat & Mudah)

Jika Anda hanya butuh routing dan tiles untuk development:

1. **Download data OSM:**

   ```powershell
   npm run download-pbf
   ```

2. **Process untuk OSRM:**

   ```powershell
   .\scripts\process-osrm.ps1
   ```

3. **Start Docker services:**

   ```powershell
   docker-compose up -d osrm-backend
   ```

4. **Test routing:**
   ```powershell
   # Buka browser: http://localhost:8080
   # Atau test dengan curl
   curl "http://localhost:8080/route?start=107.6191,-6.9175&end=107.6098,-6.9145"
   ```

### Option 2: Full Stack (Production)

Jika Anda ingin semua fitur termasuk database lokal:

1. Download data OSM
2. Process OSRM
3. Import ke PostGIS: `.\scripts\import-postgis.ps1`
4. Start semua services: `docker-compose up -d`
5. Set mode render: `$env:TILE_MODE="render"`

## 🎯 Testing

### Test API Server

Server sudah berjalan! Test dengan:

```powershell
# Health check
curl http://localhost:8080/health

# Web UI
# Buka browser: http://localhost:8080
```

### Test Tiles

```powershell
# Tile untuk Bandung area
curl "http://localhost:8080/tiles/10/897/650.png" -OutFile test-tile.png

# Buka file test-tile.png
```

## 📚 Endpoints Available

| Endpoint                 | Method | Description          |
| ------------------------ | ------ | -------------------- |
| `/health`                | GET    | Health check         |
| `/tiles/{z}/{x}/{y}.png` | GET    | Map tiles (PNG)      |
| `/route`                 | GET    | Routing (perlu OSRM) |
| `/geocode`               | GET    | Search locations     |

## 🔄 Next Steps

1. **Download data:** `npm run download-pbf` (500MB, ~5 menit)
2. **Process OSRM:** `.\scripts\process-osrm.ps1` (~20 menit)
3. **Start Docker:** `docker-compose up -d`
4. **Test routing:** Buka http://localhost:8080

## 💡 Tips

- Mode **proxy**: Tidak perlu database, tiles dari OSM
- Mode **render**: Perlu database, tiles dari PostGIS lokal
- Untuk Jawa Barat saja, data ~50GB setelah import PostGIS

## 🆘 Butuh Bantuan?

Lihat `README.md` untuk dokumentasi lengkap dan troubleshooting.
