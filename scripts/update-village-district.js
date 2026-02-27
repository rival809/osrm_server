/**
 * update-village-district.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Update village_boundaries dengan data yang akurat berdasarkan:
 *   1. Nama kecamatan dari GeoJSON (Jabar_By_Desa.geojson) → dinormalisasi →
 *      dicocokan ke district_boundaries → update district_id, p3d, p3d_id
 *   2. Kode desa dari kec/*.json (kd_pos_kd_pos) → diverifikasi/update ke unique_code
 *
 * Normalisasi: UPPERCASE + TRIM + collapse spaces + strip prefix (KEC./KECAMATAN)
 *
 * Matching tiers (per village):
 *   1. exact  : normalized name match  persis
 *   2. fuzzy  : strip all spaces
 *   3. contains: salah satu mengandung string yang lain
 *
 * Usage:
 *   DRY_RUN=1 node scripts/update-village-district.js    # preview
 *   node scripts/update-village-district.js               # apply
 *   SKIP_KEC_CODE=1 node scripts/update-village-district.js  # skip kode dari kec JSON
 *
 * Docker:
 *   DRY_RUN=1 docker exec osrm-tile-service node scripts/update-village-district.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const pgModule = (() => {
  try { return require('pg'); } catch (_) {}
  try { return require('/app/node_modules/pg'); } catch (_) {}
  throw new Error('Cannot find module pg');
})();
const { Pool } = pgModule;

// ── config ────────────────────────────────────────────────────────────────────

const DRY_RUN      = process.env.DRY_RUN      === '1';
const SKIP_KEC_CODE = process.env.SKIP_KEC_CODE === '1';
const REPORT_FILE  = process.env.REPORT_FILE
  || (process.env.NODE_ENV === 'production'
      ? '/tmp/update-village-district-report.csv'
      : path.join(__dirname, '..', 'data', 'boundaries', 'update-village-district-report.csv'));
const GEOJSON_FILE = path.join(__dirname, '..', 'data', 'boundaries', 'Jabar_By_Desa.geojson');
const KEC_DIR      = path.join(__dirname, '..', 'data', 'boundaries', 'kec');

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

// ── alias map: GeoJSON kecamatan name → canonical name in district_boundaries ──
// Tambahkan entry baru jika ada NO_DISTRICT_MATCH yang tersisa
const KEC_ALIAS = {
  // Bogor
  'KELAPA NUNGGAL':    'KLAPANUNGGAL',
  'BOJONG GEDE':       'BOJONGGEDE',
  'TAJUR HALANG':      'TAJURHALANG',
  'RANCA BUNGUR':      'RANCABUNGUR',
  // Sukabumi
  'PELABUHAN RATU':    'PALABUHANRATU',
  'KALI BUNDER':       'KALIBUNDER',
  'TEGAL BULEUD':      'TEGALBULEUD',
  'JAMPANG KULON':     'JAMPANGKULON',
  'WARUNG KIARA':      'WARUNGKIARA',
  'GEGER BITUNG':      'GEGERBITUNG',
  'PARUNG KUDA':       'PARUNGKUDA',
  'KALAPA NUNGGAL':    'KALAPANUNGGAL',
  // Garut
  'BLUBUR LIMBANGAN':  'BALUBUR LIMBANGAN',
  'KARANG TENGAH':     'KARANG TENGAH',
  // Tasikmalaya
  'PAGERAGEUNG':       'PAGEURAGEUNG',   // cek ulang
  // Majalengka
  'CINGAMBUL':         'CIGAMBUL',     // cek ulang
  'SINDANGWANGI':      'SINDANGWANGI',
  // Indramayu
  'KANDANGHAUR':       'KADANGHAUR',
  // Kota Bogor
  'TANAH SEREAL':      'TANAH SAREAL',
  // Cirebon
  'KARANGSEMBUNG':     'KARANG SEMBUNG',
  'SUSUKANLEBAK':      'SUSUKAN LEBAK',
  'TENGAH TANI':       'TENGAHTANI',
  // Subang
  'PAGADEN BARAT':     'PEGADEN BARAT', //////
  // Purwakarta
  'TEGAL WARU':        'TEGALWARU',
  'BABAKANCIKAO':      'BABAKAN CIKAO',
  'PONDOK SALAM':      'PONDOKSALAM',
  // Karawang
  'TALAGASARI':        'TELAGASARI',
  // Bekasi
  'MUARA GEMBONG':     'MUARAGEMBONG',
  // Bandung Barat
  'CIKALONG WETAN':    'CIKALONGWETAN',
  // Kota Bekasi
  'PONDOKGEDE':        'PONDOK GEDE',
  'JATISAMPURNA':      'JATI SAMPURNA',
  'PONDOKMELATI':      'PONDOK MELATI',
  'JATIASIH':          'JATI ASIH',
  'BANTARGEBANG':      'BANTAR GEBANG',
  // Kota Depok
  'SUKMA JAYA':        'SUKMAJAYA',
  // Kota Bandung
  'ASTANAANYAR':       'ASTANA ANYAR',
  'BUAHBATU':          'BUAH BATU',
  'UJUNG BERUNG':      'UJUNGBERUNG',
  'MANDALAJATI':       'MANDALA JATI',
  // Kota Sukabumi
  'WARUDOYONG':        'WARUNGDOYONG',
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Normalize: UPPERCASE + trim + collapse internal spaces + strip prefix KEC./KECAMATAN */
function norm(s) {
  return (s || '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(KECAMATAN|KEC\.?)\s+/i, '');
}

/** Strip all whitespace for fuzzy compare */
const noSpace = s => norm(s).replace(/\s/g, '');

/**
 * Match normalized kecamatan name with fallback tiers.
 * candidates: [{ key_norm, ...data }]
 */
function matchKec(name, candidates) {
  const n  = norm(name);
  const ns = noSpace(name);

  // exact
  let hit = candidates.find(c => c.key_norm === n);
  if (hit) return { match: hit, tier: 'exact' };

  // fuzzy no-space
  hit = candidates.find(c => noSpace(c.key_norm) === ns);
  if (hit) return { match: hit, tier: 'fuzzy-nospace' };

  // contains
  hit = candidates.find(c => {
    const cs = noSpace(c.key_norm);
    return cs.includes(ns) || ns.includes(cs);
  });
  if (hit) return { match: hit, tier: 'contains' };

  return null;
}

/**
 * Match normalized village name with fallback tiers.
 * candidates: [{ key_norm, ...data }]
 */
function matchVillage(name, candidates) {
  const n  = norm(name);
  const ns = noSpace(name);

  let hit = candidates.find(c => c.key_norm === n);
  if (hit) return { match: hit, tier: 'exact' };

  hit = candidates.find(c => noSpace(c.key_norm) === ns);
  if (hit) return { match: hit, tier: 'fuzzy-nospace' };

  hit = candidates.find(c => {
    const cs = noSpace(c.key_norm);
    return cs.includes(ns) || ns.includes(cs);
  });
  if (hit) return { match: hit, tier: 'contains' };

  return null;
}

/** Read kec JSON with BOM + UTF-16 handling (sama seperti migrate-village-names.js) */
function readKecJson(filePath) {
  const rawBuf = fs.readFileSync(filePath);
  let rawStr = rawBuf.toString('utf8');
  if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
  if (rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
    rawStr = rawBuf.toString('utf16le');
    if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
  }
  return JSON.parse(rawStr);
}

// ── load kec JSON → kodeMap ───────────────────────────────────────────────────
//
// kodeMap: Map< p3d_id_norm, Map< kec_norm, [{ key_norm, kode, original }] > >
//
// p3d_id_norm = String(Number('10200')) = '10200'

function loadKecDir() {
  const kodeMap = new Map();
  const files = fs.readdirSync(KEC_DIR).filter(f => f.endsWith('.json'));
  let loaded = 0, errors = 0;

  for (const file of files) {
    const p3dId = String(Number(path.basename(file, '.json'))); // strip leading zeros
    let raw;
    try {
      raw = readKecJson(path.join(KEC_DIR, file));
    } catch (e) {
      console.warn(`  [kec] WARN: cannot parse ${file}: ${e.message}`);
      errors++;
      continue;
    }
    const data = raw.data || [];
    for (const row of data) {
      const kecNorm = norm(row.kd_pos_nm_kecamatan || '');
      const desNorm = norm(row.kd_pos_nm_kelurahan || '');
      const kode    = (row.kd_pos_kd_pos || '').trim();
      if (!kecNorm || !desNorm || !kode) continue;

      if (!kodeMap.has(p3dId)) kodeMap.set(p3dId, new Map());
      const kecMap = kodeMap.get(p3dId);
      if (!kecMap.has(kecNorm)) kecMap.set(kecNorm, []);
      kecMap.get(kecNorm).push({ key_norm: desNorm, kode, original: row.kd_pos_nm_kelurahan.trim() });
    }
    loaded++;
  }
  console.log(`[kec] Loaded ${loaded} files (${errors} errors). Kabupaten: ${kodeMap.size}`);
  return kodeMap;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== update-village-district.js [${DRY_RUN ? 'DRY RUN' : 'LIVE'}] ===\n`);

  // ── 1. Load district_boundaries from DB ─────────────────────────────────
  console.log('Loading district_boundaries from DB...');
  const client = await pool.connect();
  let districtRows;
  try {
    const { rows } = await client.query(`
      SELECT id, district_id, district, p3d_id, p3d
      FROM district_boundaries
      ORDER BY p3d_id, district
    `);
    districtRows = rows;
  } finally {
    client.release();
  }
  console.log(`  → ${districtRows.length} districts loaded`);

  // Build lookup: p3d_id → [ { key_norm, ...row } ]
  // Note: p3d_id in district_boundaries is VARCHAR like "10200"
  const districtByP3d = new Map();
  for (const row of districtRows) {
    const p3d = String(Number(row.p3d_id || 0)); // normalize: "10200" → "10200"
    if (!districtByP3d.has(p3d)) districtByP3d.set(p3d, []);
    districtByP3d.get(p3d).push({ key_norm: norm(row.district), ...row });
  }

  // Also build global lookup (fallback, ignoring p3d_id)
  const districtGlobal = districtRows.map(r => ({ key_norm: norm(r.district), ...r }));

  // ── 2. Load kec JSON for village kode ───────────────────────────────────
  let kodeMap = new Map();
  if (!SKIP_KEC_CODE) {
    console.log('\nLoading kec JSON files...');
    kodeMap = loadKecDir();
  }

  // ── 3. Load GeoJSON ──────────────────────────────────────────────────────
  console.log('\nLoading GeoJSON...');
  const raw = JSON.parse(fs.readFileSync(GEOJSON_FILE, 'utf8'));
  let features;
  if (Array.isArray(raw)) {
    features = raw;
  } else if (raw.type === 'FeatureCollection' && Array.isArray(raw.features)) {
    features = raw.features.map(f => ({ ...f.properties, geom: f.geometry }));
  } else {
    throw new Error('Unrecognized GeoJSON format');
  }
  console.log(`  → ${features.length} features`);

  // ── 4. Build update plan ─────────────────────────────────────────────────
  console.log('\nBuilding update plan...');

  const report = [];
  const updatePlan = [];                  // { unique_code, district_id, district_id_db, p3d, p3d_id_db, kec_kode, kode_tier, dist_tier }
  const stats = {
    total: 0,
    distMatch: 0,
    distNoMatch: 0,
    kecKodeMatch: 0,
    kecKodeNoMatch: 0,
    kecKodeSkipped: 0,
  };

  for (const feat of features) {
    stats.total++;

    const kecName   = feat.KECAMATAN || feat.kecamatan || '';
    const desaName  = feat.DESA      || feat.desa      || '';
    // old_district_id = ID_KEC from GeoJSON — same value stored in district_id during import
    const oldDistrictId = String(feat.ID_KEC || feat.id_kec || '').trim();
    const idKab = feat.ID_KAB ? String(feat.ID_KAB) : null;

    if (!kecName || !desaName) { stats.distNoMatch++; continue; }

    // ── Match to district_boundaries ──────────────────────────────────────
    // Apply alias before matching
    const kecNameResolved = KEC_ALIAS[norm(kecName)] || kecName;

    let distResult = null;
    const kabName = feat.KABKOT ? norm(feat.KABKOT) : null;

    let scopedCandidates = districtGlobal;
    if (kabName) {
      const byKab = districtGlobal.filter(c => norm(c.p3d || '').includes(kabName) || kabName.includes(norm(c.p3d || '')));
      if (byKab.length > 0) scopedCandidates = byKab;
    }

    distResult = matchKec(kecNameResolved, scopedCandidates);
    if (!distResult && scopedCandidates !== districtGlobal) {
      distResult = matchKec(kecNameResolved, districtGlobal);
    }
    // last resort: try original name if alias didn't help
    if (!distResult && kecNameResolved !== kecName) {
      distResult = matchKec(kecName, districtGlobal);
    }

    if (!distResult) {
      stats.distNoMatch++;
      report.push({
        old_district_id: oldDistrictId,
        desa: desaName,
        kecamatan: kecName,
        kabupaten: feat.KABKOT || '',
        status: 'NO_DISTRICT_MATCH',
        note: '',
      });
      continue;
    }

    stats.distMatch++;
    const distRow = distResult.match;

    // ── Match village kode from kec JSON ──────────────────────────────────
    let kecKode  = null;
    let kodeTier = 'none';

    if (!SKIP_KEC_CODE) {
      // p3d_id from matched district (e.g. "10200")
      const p3dId = String(Number(distRow.p3d_id || 0));
      const kecMap = kodeMap.get(p3dId);

      if (!kecMap) {
        stats.kecKodeNoMatch++;
        kodeTier = 'no-file';
      } else {
        // Find kecamatan in kec JSON
        const kecCandidates = [...kecMap.entries()].map(([k, vs]) => ({ key_norm: k, villages: vs }));
        const kecHit = matchKec(kecName, kecCandidates);

        if (!kecHit) {
          stats.kecKodeNoMatch++;
          kodeTier = 'no-kec';
        } else {
          const villageCandidates = kecHit.match.villages;
          const vHit = matchVillage(desaName, villageCandidates);
          if (!vHit) {
            stats.kecKodeNoMatch++;
            kodeTier = 'no-village';
          } else {
            kecKode  = vHit.match.kode;
            kodeTier = vHit.tier;
            stats.kecKodeMatch++;
          }
        }
      }
    } else {
      stats.kecKodeSkipped++;
    }

    updatePlan.push({
      old_district_id: oldDistrictId,       // ID_KEC from GeoJSON — match key in DB
      desa:            desaName,            // DESA from GeoJSON — match key in DB
      district_id:     distRow.district_id, // new kec ID from district_boundaries
      district_db_id:  distRow.id,
      p3d:             distRow.district,    // kecamatan name (canonical)
      p3d_id:          distRow.p3d_id,      // kabupaten p3d_id (e.g. "10200")
      dist_tier:       distResult.tier,
      kode_tier:       kodeTier,
      kecamatan:       kecName,
    });

    // Only warn on non-exact district name match. kec kode NO match is suppressed
    // because kecKode is never written to the DB (unique_code/BPS code is preserved as-is).
    if (distResult.tier !== 'exact') {
      report.push({
        old_district_id: oldDistrictId,
        desa: desaName,
        kecamatan: kecName,
        kabupaten: feat.KABKOT || '',
        status: 'WARN',
        note:   `dist_tier=${distResult.tier} kec_kode_tier=${kodeTier} → district_id=${distRow.district_id}`,
      });
    }
  }

  console.log(`\nPlan summary:`);
  console.log(`  Total features   : ${stats.total}`);
  console.log(`  District matched : ${stats.distMatch}`);
  console.log(`  District NO match: ${stats.distNoMatch}`);
  if (!SKIP_KEC_CODE) {
    console.log(`  Kec kode matched : ${stats.kecKodeMatch}`);
    console.log(`  Kec kode NO match: ${stats.kecKodeNoMatch}`);
  }
  console.log(`  Update rows queued: ${updatePlan.length}`);

  // ── DRY RUN preview ───────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n-- Preview first 10 update rows --');
    updatePlan.slice(0, 10).forEach((u, i) => {
      console.log(
        `[${i}] old_district_id=${u.old_district_id} desa=${u.desa} | kec=${u.kecamatan}` +
        ` → district_id=${u.district_id} p3d=${u.p3d} p3d_id=${u.p3d_id}` +
        ` [${u.dist_tier}/${u.kode_tier}]`
      );
    });
    console.log('\n-- No-match preview (first 5) --');
    report.filter(r => r.status === 'NO_DISTRICT_MATCH').slice(0, 5).forEach((r, i) => {
      console.log(`[${i}] ${r.kecamatan} / ${r.desa} / ${r.kabupaten}`);
    });
    console.log('\nDry run complete. No data written.');
    writeReport(report);
    await pool.end();
    return;
  }

  // ── Apply updates ─────────────────────────────────────────────────────────
  console.log('\nApplying updates...');

  // Match by old district_id (ID_KEC, imported as-is) + village name (case-insensitive)
  // This avoids unique_code integer conversion issues entirely.
  const sqlUpdate = `
    UPDATE village_boundaries
    SET
      district_id = $1,
      p3d         = $2,
      p3d_id      = $3,
      updated_at  = NOW()
    WHERE district_id::text = $4
      AND UPPER(village)    = UPPER($5)
  `;

  let updated = 0, notFound = 0, errors = 0;
  const client2 = await pool.connect();

  try {
    for (let i = 0; i < updatePlan.length; i++) {
      const u = updatePlan[i];
      if (!u.old_district_id || !u.desa) { notFound++; continue; }

      try {
        const res = await client2.query(sqlUpdate, [
            u.district_id,
            u.p3d,
            u.p3d_id,
            u.old_district_id,
            u.desa,
          ]);

        if (res.rowCount > 0) updated += res.rowCount;
        else notFound++;
      } catch (err) {
        console.error(`[${i}] Error unique_code=${u.unique_code} (${u.desa}): ${err.message}`);
        errors++;
      }

      if ((i + 1) % 500 === 0) {
        console.log(`  Progress: ${i + 1}/${updatePlan.length}  updated=${updated}  notFound=${notFound}  errors=${errors}`);
      }
    }
  } finally {
    client2.release();
  }

  console.log(`\nDone.`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Not found: ${notFound} (no matching unique_code in DB)`);
  console.log(`  Errors   : ${errors}`);

  writeReport(report);
  await pool.end();
}

// ── report writer ─────────────────────────────────────────────────────────────

function writeReport(rows) {
  if (rows.length === 0) {
    console.log('\nNo warnings/errors to report.');
    return;
  }
  const header = 'old_district_id,desa,kecamatan,kabupaten,status,note';
  const lines  = rows.map(r =>
    [r.old_district_id, r.desa, r.kecamatan, r.kabupaten, r.status, r.note]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  );
  fs.writeFileSync(REPORT_FILE, [header, ...lines].join('\n'), 'utf8');
  console.log(`\nReport written: ${REPORT_FILE} (${rows.length} rows)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
