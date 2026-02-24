# Panduan Deploy OSRM Service

Panduan ini menjelaskan dua skenario deployment:

- **Mode Lite** — Hanya layanan Tiles & Routing untuk Maps
- **Mode Full** — Fitur lengkap termasuk Nominatim (geocoding) dan GeoJSON boundaries (PostGIS)

---

## Daftar Isi

- [Prasyarat](#prasyarat)
- [Persiapan Data](#persiapan-data)
- [Mode 1 — Lite: Tiles & Routing saja](#mode-1--lite-tiles--routing-saja)
- [Mode 2 — Full: Tiles, Routing, Geocoding & GeoJSON](#mode-2--full-tiles-routing-geocoding--geojson)
- [Ringkasan Endpoint API](#ringkasan-endpoint-api)
- [Troubleshooting](#troubleshooting)

---

## Prasyarat

| Kebutuhan | Mode Lite                                | Mode Full                        |
| --------- | ---------------------------------------- | -------------------------------- |
| RAM       | 4 GB minimum, 8 GB disarankan            | 16 GB minimum, 32 GB disarankan  |
| Disk      | 15 GB                                    | 150 GB (Nominatim butuh ~130 GB) |
| CPU       | 2 core                                   | 4+ core                          |
| OS        | Ubuntu 20.04+ / Debian 11+ / Windows 10+ | sama                             |
| Docker    | 24+ dengan Docker Compose v2             | sama                             |

**Instal Docker** jika belum tersedia:

```bash
# Linux
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verifikasi
docker --version
docker compose version
```

---

## Persiapan Data

Kedua mode membutuhkan tiga file data di direktori `data/`:

| File                  | Ukuran  | Kegunaan                              |
| --------------------- | ------- | ------------------------------------- |
| `java-latest.osm.pbf` | ~800 MB | Sumber data OSM                       |
| `java-latest.osrm.*`  | ~1.5 GB | Data routing OSRM yang sudah diproses |
| `java.mbtiles`        | ~2 GB   | Database tiles peta                   |

### Langkah Persiapan Data

**Opsi A — Menggunakan skrip otomatis (disarankan):**

Untuk **Mode Lite** (tiles & routing saja):

```powershell
# Windows (PowerShell as Administrator)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
.\MASTER-SETUP-LITE.ps1
```

```bash
# Linux
chmod +x MASTER-SETUP-LITE.sh
./MASTER-SETUP-LITE.sh
```

Untuk **Mode Full** (termasuk Nominatim & PostGIS):

```powershell
# Windows (PowerShell as Administrator)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
.\MASTER-SETUP.ps1
```

```bash
# Linux
chmod +x MASTER-SETUP.sh
./MASTER-SETUP.sh
```

Masing-masing skrip memiliki alur yang berbeda:

**MASTER-SETUP-LITE** (Mode Lite):

- Menginstal prasyarat (Node.js via Chocolatey jika belum ada)
- Mengunduh `indonesia-latest.osm.pbf` dari Geofabrik (~800 MB)
- Mengkonversi PBF ke MBTiles menggunakan **`tilemaker`** (npm package: `tilemaker-bin`)
- Memproses routing graph OSRM melalui skrip `scripts/process-osrm-v6.ps1` / `.sh`
- Mengarahkan ke `docker-compose.lite.yml` untuk deploy

**MASTER-SETUP** (Mode Full):

- Menginstal prasyarat (Node.js, curl)
- Mengunduh `java-latest.osm.pbf` dari Geofabrik (~800 MB)
- Mengkonversi PBF ke MBTiles menggunakan **`planetiler`** via Docker (`ghcr.io/onthegomap/planetiler:latest`)
- Memproses routing graph OSRM secara inline: `osrm-extract` → `osrm-partition` → `osrm-customize`
- Mengarahkan ke `docker-compose.yml` untuk deploy

Estimasi waktu: **20–60 menit** tergantung spesifikasi server.

**Opsi B — Manual (jika data sudah ada):**

Pastikan direktori `data/` berisi semua file di atas, lalu lanjutkan ke langkah deploy.

---

## Mode 1 — Lite: Tiles & Routing saja

### Kapan gunakan Mode Lite?

- Hanya butuh menampilkan peta dan menghitung rute navigasi
- Ingin hemat storage (~135 GB lebih hemat dari Mode Full)
- Tidak butuh fitur geocoding (nama alamat ↔ koordinat)
- Tidak butuh GeoJSON batas administrasi wilayah

### Arsitektur Mode Lite

```
Client / App
     │
     ▼ localhost:81
osrm-tile-service  (API Gateway Node.js)
     ├──► /route    → osrm-backend  (internal :5000 | host :5003)
     └──► /tiles    → tileserver    (internal :8080 | host :5001)
```

> Port yang dibuka ke host: **81** (API utama), **5001** (tileserver debug), **5003** (osrm backend debug)

**Container yang berjalan: 3**

| Container           | Image                  | Port Host | Port Internal | Fungsi              |
| ------------------- | ---------------------- | --------- | ------------- | ------------------- |
| `osrm-tile-service` | Custom Node.js         | **81**    | 81            | API gateway & proxy |
| `osrm-backend`      | osrm-backend v6.0.0    | **5003**  | 5000          | Hitung rute         |
| `osrm-tileserver`   | maptiler/tileserver-gl | **5001**  | 8080          | Sajikan tile peta   |

### Deploy Mode Lite

```bash
# 1. Build image
docker compose -f docker-compose.lite.yml build --no-cache

# 2. Jalankan semua service
docker compose -f docker-compose.lite.yml up -d

# 3. Cek status container
docker compose -f docker-compose.lite.yml ps
```

Semua container seharusnya langsung berstatus **Up** dalam hitungan detik.

### Verifikasi Mode Lite

```bash
# Health check API gateway
curl http://localhost:81/health

# Test rute: Bandung → Jakarta
curl "http://localhost:81/route?start=107.6191,-6.9175&end=106.8456,-6.2088"

# Test tile peta (simpan sebagai PNG)
curl "http://localhost:81/tiles/12/3272/1063.png" -o test-tile.png
```

Respons health check yang diharapkan:

```json
{
  "status": "ok",
  "tileserverStatus": "ok",
  "osrmStatus": "ok"
}
```

### Resource Mode Lite

| Service             | RAM         |
| ------------------- | ----------- |
| `osrm-tile-service` | ~500 MB     |
| `osrm-backend`      | ~2 GB       |
| `osrm-tileserver`   | ~1 GB       |
| **Total**           | **~3.5 GB** |

### Endpoint yang Tersedia (Mode Lite)

| Endpoint              | Metode | Deskripsi                        |
| --------------------- | ------ | -------------------------------- |
| `/health`             | GET    | Status semua service             |
| `/route`              | GET    | Hitung rute antara dua koordinat |
| `/tiles/:z/:x/:y.png` | GET    | Tile peta PNG                    |

---

## Mode 2 — Full: Tiles, Routing, Geocoding & GeoJSON

### Kapan gunakan Mode Full?

- Butuh geocoding (konversi nama tempat ↔ koordinat)
- Butuh GeoJSON batas wilayah administratif (provinsi / kota / kecamatan / desa)
- Butuh fitur split & merge polygon wilayah
- Sistem manajemen wilayah administrasi via Admin CMS

### Arsitektur Mode Full

```
Client / App
     │
     ▼ localhost:81
osrm-tile-service  (API Gateway Node.js)
     ├──► /route              → osrm-backend   (internal :5000 | host :5003)
     ├──► /tiles              → tileserver     (internal :8080 | host :5001)
     ├──► /geocode/reverse    → nominatim      (internal :8080 | host :5002)
     ├──► /geocode/search     → nominatim      (internal :8080 | host :5002)
     └──► /api/boundaries     → postgres       (internal :5432 | host :5432)

nominatim (PostgreSQL 14 built-in)
     └── Diimpor dari java-latest.osm.pbf

postgres (PostGIS standalone)
     └── Batas wilayah admin dari file SQL + skrip import
```

> Port yang dibuka ke host: **81** (API utama), **5001** (tileserver), **5002** (nominatim), **5003** (osrm backend), **5432** (postgres)

**Container yang berjalan: 5**

| Container           | Image                  | Port Host | Port Internal | Fungsi                             |
| ------------------- | ---------------------- | --------- | ------------- | ---------------------------------- |
| `osrm-tile-service` | Custom Node.js         | **81**    | 81            | API gateway & proxy                |
| `osrm-backend`      | osrm-backend v6.0.0    | **5003**  | 5000          | Hitung rute                        |
| `osrm-tileserver`   | maptiler/tileserver-gl | **5001**  | 8080          | Sajikan tile peta                  |
| `osrm-nominatim`    | mediagis/nominatim:4.4 | **5002**  | 8080          | Geocoding (built-in PostgreSQL 14) |
| `osrm-postgres`     | postgis/postgis:16-3.4 | **5432**  | 5432          | Data batas wilayah (PostGIS)       |

### Deploy Mode Full

#### Langkah 1 — Konfigurasi environment

Edit variabel penting di `docker-compose.yml` sebelum deploy:

```yaml
# Ganti password PostgreSQL (opsional tapi disarankan)
postgres:
  environment:
    - POSTGRES_PASSWORD=password_rahasia_anda

# Ganti admin token untuk Admin CMS
osrm-tile-service:
  environment:
    - ADMIN_TOKEN=token_rahasia_yang_kuat
    - PGPASSWORD=password_rahasia_anda # sesuaikan dengan postgres
```

#### Langkah 2 — Build dan jalankan service

```bash
# Build image
docker compose build --no-cache

# Jalankan semua 5 container
docker compose up -d

# Pantau log (opsional)
docker compose logs -f
```

#### Langkah 3 — Tunggu Nominatim selesai import

> **Penting:** Nominatim perlu mengimpor seluruh data OSM Java Island ke dalam database-nya sendiri. Proses ini memakan waktu **2–4 jam** dan membutuhkan ~130 GB disk.

Pantau progres import:

```bash
# Pantau log Nominatim
docker compose logs -f nominatim

# Cek status import via API
curl http://localhost:5002/status.php
```

Nominatim siap digunakan ketika status menampilkan `OK` dan tidak ada lagi log `Importing...`.

#### Langkah 4 — Import data batas wilayah ke PostGIS

Setelah container `postgres` berjalan, impor data batas wilayah administratif:

```bash
# Masuk ke dalam container osrm-tile-service
docker compose exec osrm-tile-service sh

# Di dalam container, jalankan import
# Provinsi
node scripts/import-province-boundaries.js

# Kota/Kabupaten
node scripts/import-district-boundaries.js

# Kecamatan & Desa (opsional, data besar)
node scripts/import-village-boundaries.js
```

Atau gunakan `npm run` dari host (jika Node.js terinstal lokal):

```bash
npm run db:import:provinces
npm run db:import:districts
npm run db:import:villages
```

#### Langkah 5 — Verifikasi Mode Full

```bash
# Health check keseluruhan
curl http://localhost:81/health

# Test geocoding reverse (koordinat → alamat)
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"

# Test geocoding forward (nama → koordinat)
curl "http://localhost:81/geocode/search?q=Bandung"

# Test GeoJSON batas wilayah kota di Jawa Barat
curl "http://localhost:81/api/boundaries/city?parent_code=32&zoom=10"

# Test rute
curl "http://localhost:81/route?start=107.6191,-6.9175&end=106.8456,-6.2088"
```

Respons health check yang diharapkan:

```json
{
  "status": "ok",
  "tileserverStatus": "ok",
  "nominatimStatus": "ok",
  "osrmStatus": "ok"
}
```

### Resource Mode Full

| Service             | RAM                         |
| ------------------- | --------------------------- |
| `osrm-tile-service` | ~500 MB                     |
| `osrm-backend`      | ~2–4 GB                     |
| `osrm-tileserver`   | ~1–2 GB                     |
| `osrm-nominatim`    | ~2–4 GB (4+ GB saat import) |
| `osrm-postgres`     | ~2–4 GB                     |
| **Total**           | **~8–18 GB**                |

### Endpoint yang Tersedia (Mode Full)

| Endpoint                 | Metode | Deskripsi                                 |
| ------------------------ | ------ | ----------------------------------------- |
| `/health`                | GET    | Status semua service                      |
| `/route`                 | GET    | Hitung rute antara dua koordinat          |
| `/tiles/:z/:x/:y.png`    | GET    | Tile peta PNG                             |
| `/geocode/reverse`       | GET    | Koordinat → nama alamat (via Nominatim)   |
| `/geocode/search`        | GET    | Nama tempat → koordinat (via Nominatim)   |
| `/api/boundaries/:level` | GET    | GeoJSON batas wilayah admin (via PostGIS) |
| `/api/boundaries/split`  | POST   | Pecah polygon wilayah menjadi dua         |
| `/api/boundaries/merge`  | POST   | Gabungkan polygon wilayah                 |

**Parameter `:level`** untuk boundaries: `province`, `city`, `district`, `village`

---

## Ringkasan Endpoint API

### GET `/route`

```
GET /route?start=<lon,lat>&end=<lon,lat>
```

Contoh:

```bash
curl "http://localhost:81/route?start=107.6191,-6.9175&end=106.8456,-6.2088"
```

---

### GET `/tiles/:z/:x/:y.png`

```
GET /tiles/{zoom}/{x}/{y}.png
```

Gunakan dalam Leaflet / MapLibre:

```javascript
tileUrl: "http://<server-ip>:81/tiles/{z}/{x}/{y}.png";
```

---

### GET `/geocode/reverse` _(Mode Full)_

```
GET /geocode/reverse?lat=<latitude>&lon=<longitude>
```

Contoh:

```bash
curl "http://localhost:81/geocode/reverse?lat=-6.9175&lon=107.6191"
```

---

### GET `/geocode/search` _(Mode Full)_

```
GET /geocode/search?q=<nama+tempat>
```

Contoh:

```bash
curl "http://localhost:81/geocode/search?q=Kota+Bandung"
```

---

### GET `/api/boundaries/:level` _(Mode Full)_

```
GET /api/boundaries/city?parent_code=32&zoom=10
```

| Query param   | Wajib    | Deskripsi                                      |
| ------------- | -------- | ---------------------------------------------- |
| `parent_code` | Opsional | Kode wilayah induk (contoh: `32` = Jawa Barat) |
| `zoom`        | Opsional | Level zoom untuk simplifikasi geometri (0–18)  |

---

## Troubleshooting

### Container tidak mau naik

```bash
# Cek log container
docker compose logs <nama-container>

# Cek apakah port sudah terpakai
netstat -tulpn | grep -E '81|5001|5002|5003|5432'
```

### Nominatim lama sekali atau error

- Proses import normal memakan waktu 2–4 jam — tunggu dan pantau log
- Pastikan ada cukup disk (~130 GB free)
- Pastikan `./data/java-latest.osm.pbf` ada dan tidak korup:

  ```bash
  ls -lh data/java-latest.osm.pbf
  ```

### Geocoding tidak akurat / tidak menemukan lokasi

- Nominatim belum selesai import — cek `curl http://localhost:5002/status.php`
- Data PBF mungkin lama, perlu diunduh ulang

### Tiles tidak muncul

- Pastikan file `data/java.mbtiles` ada:
  ```bash
  ls -lh data/java.mbtiles
  ```
- Restart tileserver:
  ```bash
  docker compose restart tileserver
  ```

### API boundaries mengembalikan data kosong

- Data batas wilayah belum diimpor ke PostGIS
- Jalankan ulang skrip import di [Langkah 4](#langkah-4--import-data-batas-wilayah-ke-postgis)

### Reset total (hapus semua data dan mulai ulang)

```bash
docker compose down -v   # hapus container + volume
docker compose up -d     # jalankan ulang
```

> **Peringatan:** `-v` akan menghapus semua volume Docker termasuk database Nominatim. Proses import harus diulang dari awal.

---

## Perbandingan Cepat

| Fitur                        | Mode Lite                 | Mode Full            |
| ---------------------------- | ------------------------- | -------------------- |
| Tile peta                    | ✅                        | ✅                   |
| Kalkulasi rute               | ✅                        | ✅                   |
| Geocoding (nama ↔ koordinat) | ❌                        | ✅                   |
| GeoJSON batas wilayah        | ❌                        | ✅                   |
| Admin CMS batas wilayah      | ❌                        | ✅                   |
| Waktu setup                  | ~30 menit                 | ~3–5 jam             |
| Kebutuhan disk               | ~15 GB                    | ~150 GB              |
| Kebutuhan RAM                | 4 GB                      | 16 GB                |
| Jumlah container             | 3                         | 5                    |
| File compose                 | `docker-compose.lite.yml` | `docker-compose.yml` |
