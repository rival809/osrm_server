const fs = require('fs');
const https = require('https');
const path = require('path');

/**
 * Script untuk download PBF file untuk pulau Jawa dari Geofabrik
 */

const PBF_URL = 'https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf';
const OUTPUT_DIR = path.join(__dirname, '../data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'java-latest.osm.pbf');

console.log('📥 Mengunduh data OSM untuk Pulau Jawa...');
console.log('⚠️  File ini ~180MB, proses akan memakan waktu beberapa menit');
console.log('🔗 Source:', PBF_URL);

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Download file
const file = fs.createWriteStream(OUTPUT_FILE);
let downloadedBytes = 0;

https.get(PBF_URL, (response) => {
  const totalBytes = parseInt(response.headers['content-length'], 10);
  
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(2);
    const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(2);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    
    process.stdout.write(`\r⏬ Progress: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`);
  });

  response.pipe(file);

  file.on('finish', () => {
    file.close();
    console.log('\n✅ Download selesai!');
    console.log(`📁 File disimpan di: ${OUTPUT_FILE}`);
    console.log('\n📌 Langkah selanjutnya:');
    console.log('   1. Jalankan: npm run process-osrm');
    console.log('   2. Jalankan: npm run import-postgis');
    console.log('   3. Jalankan: docker-compose up -d');
  });

}).on('error', (err) => {
  fs.unlink(OUTPUT_FILE, () => {});
  console.error('\n❌ Error saat download:', err.message);
  process.exit(1);
});
