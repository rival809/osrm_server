# Prerequisites Check - MASTER-SETUP

## ✅ Status Sistem Anda

### Windows Version

- **OS:** Windows 10/11 (Build 22621)
- **curl.exe:** ✅ **TERSEDIA** (curl 8.4.0 - Built-in)
- **Status:** Siap untuk download cepat!

---

## 📋 Prerequisites yang Dicek Otomatis

### MASTER-SETUP.ps1 (Windows)

Script akan mengecek dan menginstall (jika perlu):

1. **✅ Node.js**

   - Check: `node --version`
   - Auto-install: Via Chocolatey atau manual prompt
   - Required for: API server

2. **✅ Docker Desktop**

   - Check: `docker --version` dan `docker ps`
   - Auto-install: Via Chocolatey atau manual prompt
   - Required for: OSRM backend container

3. **✅ curl.exe** (NEW!)

   - Check: `curl.exe --version`
   - **Tidak perlu install** - Built-in pada:
     - Windows 10 version 1803+ (April 2018+)
     - Windows 11 (all versions)
   - Fallback: PowerShell download (lebih lambat tapi tetap bekerja)
   - Used for: Fast OSM data download

4. **✅ Chocolatey** (Optional)
   - Auto-install jika diperlukan
   - Used for: Easy package installation

### MASTER-SETUP.sh (Linux)

Script akan mengecek dan menginstall (jika perlu):

1. **✅ Node.js**

   - Check: `node --version`
   - Auto-install: Via package manager (apt/yum/pacman)
   - Required for: API server

2. **✅ Docker**

   - Check: `docker --version` dan `docker ps`
   - Auto-install: Via get.docker.com script
   - Required for: OSRM backend container

3. **✅ curl** (NEW!)

   - Check: `curl --version`
   - Auto-install: Via package manager (apt/yum/pacman)
   - **Priority #1** untuk download (paling cepat)

4. **✅ wget** (NEW!)

   - Check: `wget --version`
   - Auto-install: Via package manager
   - **Fallback** jika curl tidak tersedia

5. **✅ System Tools**
   - jq (JSON parsing)
   - bc (calculations)
   - build-essential/gcc (untuk native modules)

---

## 🔍 Pengecekan Prerequisites

### Kapan Dicek?

- **Otomatis** saat menjalankan `MASTER-SETUP.ps1` atau `MASTER-SETUP.sh`
- Sebelum mulai download atau setup apapun
- Akan menampilkan status setiap tool

### Output Example (Windows):

```
============================================================
  PREREQUISITES INSTALLATION
============================================================

🔹 Checking Node.js
   JavaScript runtime
✅ Node.js already installed: v20.10.0

🔹 Checking Docker
   Container platform
✅ Docker already installed: Docker version 24.0.6

🔹 Checking curl
   Download utility (optional but recommended)
✅ curl.exe available: curl 8.4.0 (Windows)
   ✓ Fast downloads enabled

🔹 Checking Docker status
   Verify Docker daemon is running
✅ Docker is running
```

### Output Example (Linux):

```
============================================================
  PREREQUISITES INSTALLATION
============================================================

🔹 Checking system packages
   curl, wget, jq, bc
✅ System packages already available

🔹 Checking download utilities
   curl or wget required
   ✓ curl available: curl 7.68.0
   ✓ wget available: GNU Wget 1.20.3
✅ Download tools ready (curl preferred for faster downloads)

🔹 Checking Node.js
   JavaScript runtime
✅ Node.js already installed: v20.10.0

🔹 Checking Docker
   Container platform
✅ Docker already installed: Docker version 24.0.6
```

---

## 🚀 Instalasi Otomatis

### Windows

Jika tool tidak ditemukan:

1. **Chocolatey** → Auto-install package manager
2. **Node.js** → `choco install nodejs -y`
3. **Docker** → `choco install docker-desktop -y`
4. **curl.exe** → **Tidak perlu**, sudah built-in!

### Linux

Jika tool tidak ditemukan:

1. **System packages** → `apt/yum/pacman install curl wget jq bc`
2. **Node.js** → Via NodeSource repository
3. **Docker** → Via get.docker.com convenience script
4. **curl/wget** → Auto-install bersama system packages

---

## ⚠️ Jika Instalasi Otomatis Gagal

### Windows

```powershell
# Manual installation links akan ditampilkan:
# - Node.js: https://nodejs.org/
# - Docker: https://desktop.docker.com/
# - curl: Tidak perlu (sudah built-in Win10+)
```

### Linux

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y curl wget jq bc nodejs docker.io

# CentOS/RHEL
sudo yum update -y
sudo yum install -y curl wget jq bc nodejs docker

# Arch
sudo pacman -Sy curl wget jq bc nodejs docker
```

---

## 📊 Download Method Priority

Berdasarkan tools yang tersedia:

### Windows

1. **curl.exe** ✅ (Recommended - 2-3x faster)
2. **PowerShell WebClient** (Fallback - slower but works)

### Linux

1. **curl** ✅ (Recommended - fastest, best progress)
2. **wget** (Fallback - fast, good progress)
3. **Error** (If neither available)

---

## 💡 FAQ

### Q: Apakah harus install curl di Windows?

**A:** **TIDAK!** curl.exe sudah built-in di Windows 10 (1803+) dan Windows 11. Sistem Anda sudah memilikinya.

### Q: Bagaimana jika curl tidak tersedia?

**A:** Script akan otomatis fallback ke PowerShell download. Lebih lambat tapi tetap bekerja.

### Q: Apakah perlu admin rights?

**A:**

- **Untuk pengecekan**: TIDAK
- **Untuk instalasi**: YA (jika perlu install Node/Docker)
- **Untuk curl**: TIDAK (sudah ada)

### Q: Di Linux, curl atau wget yang lebih baik?

**A:** **curl** sedikit lebih cepat dan progress bar lebih baik, tapi keduanya bagus. Script prioritaskan curl.

### Q: Bisa skip prerequisites check?

**A:** Tidak disarankan. Prerequisites diperlukan untuk menjalankan OSRM service. Tapi Anda bisa install manual lalu jalankan script.

---

## ✅ Kesimpulan

### Sistem Anda (Windows 10/11 Build 22621):

- ✅ **curl.exe tersedia** - Download akan cepat!
- ✅ **Tidak perlu install curl** - Sudah built-in
- ✅ Script akan auto-check semua prerequisites
- ✅ Auto-install tools yang missing (dengan permission)

### Next Steps:

```powershell
# Cukup jalankan:
.\MASTER-SETUP.ps1

# Script akan:
# 1. ✅ Check prerequisites (termasuk curl)
# 2. ✅ Install missing tools (jika perlu)
# 3. ✅ Download OSM data (dengan curl - cepat!)
# 4. ✅ Setup OSRM service
# 5. ✅ Start & validate
```

Anda siap untuk menjalankan setup! 🚀
