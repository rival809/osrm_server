/**
 * migrate-village-names.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Updates village_boundaries.village (nama desa/kelurahan) using
 * reference data from data/boundaries/kec/*.json as source of truth.
 *
 * SOURCE OF TRUTH:
 *   data/boundaries/kec/<kd_wil>.json  (data dari API kd-pos)
 *   Field: kd_pos_nm_kelurahan  → nama baru yang akan di-update ke DB
 *
 * How matching works:
 *   1. Scope per kabupaten:
 *      JSON kd_pos_kd_wil (e.g. "10200") → district_boundaries.p3d_id
 *   2. Scope per kecamatan:
 *      JSON kd_pos_nm_kecamatan → village_boundaries.p3d (nama kecamatan)
 *   3. Match per desa:
 *      a. Exact   : UPPER TRIM collapse-spaces
 *      b. Fuzzy   : strip all spaces then compare
 *      c. Contains: salah satu mengandung yang lain (setelah strip spaces)
 *   Unmatched → dicatat ke report CSV, di-skip
 *
 * Join:
 *   village_boundaries.p3d (nama kecamatan)
 *     ↔ district_boundaries.district
 *     WHERE district_boundaries.p3d_id = <kd_wil dari JSON>
 *
 * Usage:
 *   DRY_RUN=1 node scripts/migrate-village-names.js   # preview
 *   node scripts/migrate-village-names.js              # apply
 *
 * Docker:
 *   docker exec osrm-tile-service node scripts/migrate-village-names.js
 *   DRY_RUN=1 docker exec osrm-tile-service node scripts/migrate-village-names.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Support running from /app/scripts inside Docker (node_modules is at /app/node_modules)
const pgModule = (() => {
  try { return require('pg'); } catch (_) {}
  try { return require('/app/node_modules/pg'); } catch (_) {}
  throw new Error('Cannot find module pg');
})();
const { Pool } = pgModule;

// ── config ────────────────────────────────────────────────────────────────────

const KEC_DIR = path.join(__dirname, '..', 'data', 'boundaries', 'kec');
const DRY_RUN = process.env.DRY_RUN === '1';

const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     parseInt(process.env.PGPORT)  || 5432,
  database: process.env.PGDATABASE || 'nominatim',
  user:     process.env.PGUSER     || 'nominatim',
  password: process.env.PGPASSWORD || 'nominatim123',
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Normalize: uppercase + trim + collapse internal spaces */
const norm    = s => (s || '').toUpperCase().trim().replace(/\s+/g, ' ');
/** Strip all spaces (for fuzzy compare) */
const noSpace = s => norm(s).replace(/\s/g, '');

/**
 * Safely read + parse a kec JSON file with BOM stripping.
 */
function readKecJson(filePath) {
  const rawBuf = fs.readFileSync(filePath);
  let rawStr = rawBuf.toString('utf8');
  // Strip UTF-8 BOM
  if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
  // Handle UTF-16 LE (PowerShell export)
  if (rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
    rawStr = rawBuf.toString('utf16le');
    if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
  }
  return JSON.parse(rawStr);
}

/**
 * Extract kelurahan/desa from one JSON file, grouped by normalized kecamatan name.
 * Returns Map<nm_kecamatan_norm, Map<nm_kelurahan_norm, nm_kelurahan_original>>
 */
function extractKelurahan(data) {
  const byKec = new Map();
  for (const row of data) {
    const nmKec  = (row.kd_pos_nm_kecamatan || '').trim();
    const nmDesa = (row.kd_pos_nm_kelurahan  || '').trim();
    if (!nmKec || !nmDesa) continue;
    const kn = norm(nmKec);
    if (!byKec.has(kn)) byKec.set(kn, new Map());
    const dn = norm(nmDesa);
    // store first occurrence (normalized key → original value)
    if (!byKec.get(kn).has(dn)) byKec.get(kn).set(dn, nmDesa);
  }
  return byKec;
}

/**
 * Find the best matching village_boundaries DB row for a new desa name.
 * Returns { dbRow, matchType } or null.
 */
function findVillageMatch(nmDesaNew, dbRows) {
  const n  = norm(nmDesaNew);
  const ns = noSpace(nmDesaNew);

  // 1. Exact (normalized)
  let hit = dbRows.find(r => norm(r.village) === n);
  if (hit) return { dbRow: hit, matchType: 'exact' };

  // 2. Fuzzy: strip all spaces
  hit = dbRows.find(r => noSpace(r.village) === ns);
  if (hit) return { dbRow: hit, matchType: 'fuzzy-nospace' };

  // 3. Contains (longer contains shorter)
  hit = dbRows.find(r => {
    const rns = noSpace(r.village);
    return rns.includes(ns) || ns.includes(rns);
  });
  if (hit) return { dbRow: hit, matchType: 'fuzzy-contains' };

  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏘️  migrate-village-names.js  [${DRY_RUN ? 'DRY RUN' : 'LIVE'}]\n`);

  const client = await pool.connect();
  const summary = {
    total:     0,
    matched:   0,
    unchanged: 0,
    skipped:   0,
    unmatched: [],
  };

  try {
    // ── Load all village_boundaries with kecamatan + kabupaten context ──────
    // Join to district_boundaries via kecamatan name (village_boundaries.p3d)
    // to resolve kabupaten (p3d_id) for scoping.
    const { rows: allVillages } = await client.query(`
      SELECT
        vb.id,
        vb.village,
        vb.p3d                        AS kec_name,
        vb.district_id,
        db.p3d_id                     AS kab_p3d_id,
        db.district                   AS kec_name_db
      FROM village_boundaries vb
      LEFT JOIN district_boundaries db
        ON UPPER(TRIM(vb.p3d)) = UPPER(TRIM(db.district))
      ORDER BY db.p3d_id, vb.p3d, vb.village
    `);

    console.log(`📦 DB: ${allVillages.length} village rows loaded\n`);

    // Village rows yang tidak bisa di-join ke kabupaten
    const noKabCount = allVillages.filter(r => !r.kab_p3d_id).length;
    if (noKabCount > 0) {
      console.log(`⚠️  ${noKabCount} village rows tidak bisa di-join ke kabupaten (p3d null/kosong)\n`);
    }

    // Group DB rows by (kab_p3d_id as integer, kec_name_norm)
    const dbByKabKec = new Map();
    for (const row of allVillages) {
      // kab_p3d_id di DB bisa integer atau string, normalisasi ke string angka tanpa leading zero
      let kabId = row.kab_p3d_id;
      if (kabId !== null && kabId !== undefined) kabId = String(Number(kabId));
      else kabId = '__unknown__';
      const kecNm  = norm(row.kec_name || '');
      const key    = `${kabId}|${kecNm}`;
      if (!dbByKabKec.has(key)) dbByKabKec.set(key, []);
      dbByKabKec.get(key).push(row);
    }

    // ── Scan JSON files ──────────────────────────────────────────────────────
    const files = fs.readdirSync(KEC_DIR).filter(f => f.endsWith('.json')).sort();
    console.log(`📂 JSON files: ${files.length}\n`);

    // ── Backup (even if DRY_RUN skips it, log the intent) ───────────────────
    if (!DRY_RUN) {
      const backupTable = `village_boundaries_backup_${Date.now()}`;
      console.log(`💾 Creating backup: ${backupTable} ...`);
      await client.query(`CREATE TABLE ${backupTable} AS SELECT * FROM village_boundaries`);
      console.log(`✅ Backup created: ${backupTable}`);
      console.log(`   Rollback: DROP TABLE village_boundaries; ALTER TABLE ${backupTable} RENAME TO village_boundaries;\n`);

      await client.query('BEGIN');
    }

    // ── Process each kabupaten file ──────────────────────────────────────────
    for (const file of files) {
      // kdWil dari JSON bisa leading zero, normalisasi ke string angka tanpa leading zero
      let kdWil = path.basename(file, '.json');
      // Always normalize kdWil to string number without leading zero (for matching DB)
      kdWil = String(Number(kdWil));

      let raw;
      try {
        raw = readKecJson(path.join(KEC_DIR, file));
      } catch (e) {
        console.log(`⚠️  ${kdWil}: gagal parse JSON – ${e.message}`);
        continue;
      }

      const data = raw.data || [];
      if (!data.length) { console.log(`⚠️  ${kdWil}: empty, skip`); continue; }

      const byKec = extractKelurahan(data);
      const totalDesa = [...byKec.values()].reduce((a, m) => a + m.size, 0);
      console.log(`── ${kdWil}  (${byKec.size} kec · ${totalDesa} kelurahan)`);

      let fileMatched = 0, fileTotal = 0;

      for (const [kecNorm, desaMap] of byKec) {
        // kdWil is already normalized to string number without leading zero
        const key    = `${kdWil}|${kecNorm}`;
        const dbRows = dbByKabKec.get(key) || [];

        if (!dbRows.length) {
          // Coba fuzzy match pada kecamatan (no-space)
          const kecNS = noSpace(kecNorm);
          let altKey = null;
          for (const [k] of dbByKabKec) {
            if (!k.startsWith(`${kdWil}|`)) continue;
            const kpart = k.slice(kdWil.length + 1);
            if (noSpace(kpart) === kecNS) { altKey = k; break; }
          }

          const fallbackRows = altKey ? dbByKabKec.get(altKey) : [];
          if (!fallbackRows.length) {
            console.log(`  ⚠️  kec "${kecNorm}": 0 DB rows di kab ${kdWil}`);
            for (const [, nm] of desaMap) {
              summary.unmatched.push({ kdWil, kec: kecNorm, desa: nm, dbVillage: '-', reason: 'no DB rows for kecamatan' });
              summary.skipped++;
            }
            continue;
          }
          // use fallback
          dbRows.push(...fallbackRows);
        }

        for (const [, nmDesaNew] of desaMap) {
          summary.total++;
          fileTotal++;

          const result = findVillageMatch(nmDesaNew, dbRows);

          if (!result) {
            console.log(`    ❌ NO MATCH  [${kecNorm}] "${nmDesaNew}"`);
            summary.skipped++;
            summary.unmatched.push({ kdWil, kec: kecNorm, desa: nmDesaNew, dbVillage: '(no match)', reason: 'unmatched' });
            continue;
          }

          const { dbRow, matchType } = result;
          const newName = norm(nmDesaNew);   // UPPER TRIM normalized
          const oldName = norm(dbRow.village);

          if (oldName === newName) {
            // Sudah sama, tidak perlu update
            summary.unchanged++;
            summary.matched++;
            fileMatched++;
            continue;
          }

          const icon = matchType === 'exact' ? '✅' : '🔶';
          console.log(`    ${icon} [${matchType}] "${dbRow.village}" → "${newName}"`);

          if (!DRY_RUN) {
            await client.query(
              `UPDATE village_boundaries SET village = $1, updated_at = NOW() WHERE id = $2`,
              [newName, dbRow.id]
            );
            // Prevent double-matching within the same kecamatan group
            dbRow._matched = true;
          }

          summary.matched++;
          fileMatched++;
        }
      }

      console.log(`   → matched: ${fileMatched}/${fileTotal}\n`);
    }

    if (!DRY_RUN) await client.query('COMMIT');

  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  // ── Final report ───────────────────────────────────────────────────────────

  console.log('═'.repeat(60));
  console.log(`TOTAL       : ${summary.total}`);
  console.log(`MATCHED     : ${summary.matched}  (unchanged: ${summary.unchanged}, updated: ${summary.matched - summary.unchanged})`);
  console.log(`UNMATCHED   : ${summary.skipped}`);
  console.log(`STATUS      : ${DRY_RUN ? 'DRY RUN – tidak ada perubahan ke DB' : 'COMMITTED'}`);
  console.log('═'.repeat(60));

  if (summary.unmatched.length) {
    console.log('\n⚠️  UNMATCHED LIST:');
    console.log('  kd_wil  | kecamatan                      | desa_baru                    | desa_db      | alasan');
    console.log('  ' + '-'.repeat(100));
    summary.unmatched.forEach(r =>
      console.log(
        `  ${r.kdWil.padEnd(7)} | ${r.kec.padEnd(30)} | ${r.desa.padEnd(28)} | ${r.dbVillage.padEnd(12)} | ${r.reason}`
      )
    );

    // Simpan CSV report
    const candidates = [
      path.join(__dirname, '..', 'data', 'boundaries', 'migrate-village-unmatched.csv'),
      '/tmp/migrate-village-unmatched.csv',
    ];
    const header = 'kd_wil,kecamatan,desa_baru,desa_db,alasan';
    const csvRows = summary.unmatched.map(r =>
      [r.kdWil, r.kec, r.desa, r.dbVillage, r.reason]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...csvRows].join('\n');
    for (const p of candidates) {
      try {
        fs.writeFileSync(p, csv, 'utf8');
        console.log(`\n📄 Report saved → ${p}`);
        break;
      } catch (_) { /* try next */ }
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
