# MASTER-SETUP - Quick Reference Guide

## Overview

Master setup scripts untuk complete end-to-end OSRM service setup dengan performa download yang ditingkatkan.

## Perubahan Terbaru

### ✅ Windows (MASTER-SETUP.ps1)

**Peningkatan Download Performance:**

- ✅ Menggunakan `curl.exe` sebagai method utama (lebih cepat)
- ✅ Fallback ke PowerShell WebClient jika curl tidak tersedia
- ✅ Progress tracking yang lebih baik
- ✅ Error handling yang lebih robust

**Cara Penggunaan:**

```powershell
# Jalankan dengan PowerShell (bukan bash/Git Bash)
.\MASTER-SETUP.ps1

# Dengan parameter
.\MASTER-SETUP.ps1 -Mode auto -Region java -Environment production
```

### ✅ Linux (MASTER-SETUP.sh)

**Peningkatan Download Performance:**

- ✅ Menggunakan `curl` sebagai method utama (lebih cepat & progress bar lebih baik)
- ✅ Fallback ke `wget` jika curl tidak tersedia
- ✅ Better progress display dengan `--progress-bar`
- ✅ Error handling yang lebih baik

**Cara Penggunaan:**

```bash
# Jalankan dengan bash
chmod +x MASTER-SETUP.sh
./MASTER-SETUP.sh

# Dengan parameter
./MASTER-SETUP.sh auto java production
```

## Fitur Download Script

### Method Prioritas:

1. **curl** (Primary - faster, better progress)
   - Windows: `curl.exe` (built-in Windows 10+)
   - Linux: `curl` command
2. **wget/PowerShell** (Fallback)
   - Windows: PowerShell WebClient async
   - Linux: wget with progress bar

### Keuntungan curl:

- ✅ 2-3x lebih cepat dari PowerShell Invoke-WebRequest
- ✅ Progress bar yang lebih informatif
- ✅ Resume capability (dengan parameter -C)
- ✅ Better timeout handling

## Script Collection

### Download Scripts:

- `download-pbf.ps1` - Original PowerShell (simple)
- `download-pbf-curl.ps1` - **NEW** curl-based (fastest)
- `download-pbf-improved.ps1` - **NEW** Advanced with progress tracking
- `download-pbf-fast.cmd` - **NEW** Batch wrapper for curl
- `monitor-download.ps1` - **NEW** Monitor ongoing download

### Recommended Usage:

**Untuk download cepat:**

```powershell
# Windows
.\scripts\download-pbf-curl.ps1

# Linux
curl -L --progress-bar -o data/java-latest.osm.pbf \
  https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
```

**Untuk monitor progress saat download berjalan:**

```powershell
.\scripts\monitor-download.ps1
```

## Troubleshooting

### Download Stuck/Lambat:

1. **Check progress:** Jalankan `monitor-download.ps1`
2. **Cancel & restart:** Ctrl+C, lalu jalankan dengan curl:
   ```powershell
   .\scripts\download-pbf-curl.ps1
   ```

### Curl Not Found:

- Windows 10+: curl.exe sudah built-in
- Older Windows: Download dari https://curl.se/windows/
- Linux: `sudo apt-get install curl` atau `sudo yum install curl`

### Download Manual:

Jika semua method gagal, download manual:

1. Buka: https://download.geofabrik.de/asia/indonesia.html
2. Download "java-latest.osm.pbf"
3. Simpan ke folder `data/`

## Status Download Saat Ini

Jika Anda sedang download sekarang:

- Sudah mencapai ~28% (227MB dari 800MB)
- Estimasi selesai: 15-20 menit lagi
- **Rekomendasi:** Biarkan selesai, jangan restart

## Next Steps After Download

Setelah download selesai (otomatis dalam MASTER-SETUP):

1. ✅ Process OSRM data (extract, partition, customize)
2. ✅ Start OSRM backend container
3. ✅ Start API server
4. ✅ Setup tile cache
5. ✅ Health checks & validation

## Complete Setup Flow

```
MASTER-SETUP
    ├── Prerequisites Check
    ├── Environment Setup (.env, directories)
    ├── OSM Data Download (curl → fallback)
    ├── OSRM Data Processing
    ├── Docker Container Setup
    ├── Cache Preloading
    └── Health Validation
```

## Tips untuk Performa Optimal

1. **Gunakan curl jika tersedia** (2-3x lebih cepat)
2. **Pastikan koneksi stabil** untuk file 800MB
3. **Jangan restart download** jika sudah >20%
4. **Monitor dengan script** bukan manual check
5. **Untuk production:** Pertimbangkan download terpisah dulu

## Support

Jika menemui masalah:

1. Check monitor-download.ps1 untuk status
2. Review logs di terminal
3. Try manual download jika semua gagal
4. Check network/firewall jika timeout

---

**Last Updated:** December 3, 2025
**Version:** 2.0 (curl-optimized)
