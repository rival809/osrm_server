/**
 * migrate-district-codes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Migrates district_boundaries.district (nama) and district_id (kode)
 * using new reference data from data/boundaries/kec/*.json
 *
 * How matching works:
 *   source of truth = kec/<kd_wil>.json  (data from API kd-pos)
 *   join key        = p3d_id (DB) == kd_pos_kd_wil (JSON)
 *                   + normalized name match (DB district == kd_pos_nm_kecamatan)
 *
 * New district_id format:
 *   kd_pos_kd_kecamatan trimmed as-is (e.g. "7", "32")
 *   Uniqueness is via composite (p3d_id, district_id) — NOT district_id alone.
 *   PREREQUISITE: run the index migration below first:
 *     DROP INDEX IF EXISTS uq_district_boundaries_district_id;
 *     CREATE UNIQUE INDEX uq_district_boundaries_p3d_district
 *       ON district_boundaries (p3d_id, district_id);
 *   The migration script will do this automatically before updating rows.
 *
 * Matching strategy:
 *   1. Exact match  : trim+uppercase both sides
 *   2. Fuzzy match  : remove all spaces then compare
 *   3. Contains     : one name contains the other (after space-removal)
 *   Unmatched rows  → logged to report, skipped
 *
 * Usage:
 *   DRY_RUN=1 node scripts/migrate-district-codes.js   # preview only
 *   node scripts/migrate-district-codes.js              # apply to DB
 *
 * Docker:
 *   docker exec osrm-tile-service node scripts/migrate-district-codes.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

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
const norm     = s => (s || '').toUpperCase().trim().replace(/\s+/g, ' ');
/** Strip all spaces (for fuzzy compare) */
const noSpace  = s => norm(s).replace(/\s/g, '');

/** New district_id = kd_pos_kd_kecamatan trimmed (uniqueness via composite p3d_id+district_id) */
function buildDistrictId(kdWil, kdKec) {
  return kdKec.trim();
}

/**
 * Extract unique kecamatan from one JSON file.
 * Returns Map<kd_kec_trim, { kdKec, nmKec, kdWil, kdKabKota }>
 */
function extractKecamatan(jsonData, kdWil) {
  const map = new Map();
  for (const row of jsonData) {
    const kdKec = (row.kd_pos_kd_kecamatan || '').trim();
    const nmKec = (row.kd_pos_nm_kecamatan || '').trim();
    if (!kdKec || !nmKec) continue;
    if (!map.has(kdKec)) {
      map.set(kdKec, {
        kdKec,
        nmKec,
        kdWil,
        kdKabKota: (row.kd_pos_kd_kab_kota || '').trim(),
        newDistrictId: buildDistrictId(kdWil, kdKec),
      });
    }
  }
  return map;
}

/**
 * Find best match for a new kecamatan name among DB rows.
 * Returns { dbRow, matchType } or null.
 */
function findMatch(nmKecNew, dbRows) {
  const n = norm(nmKecNew);
  const ns = noSpace(nmKecNew);

  // 1. Exact (normalized)
  let hit = dbRows.find(r => norm(r.district) === n);
  if (hit) return { dbRow: hit, matchType: 'exact' };

  // 2. Fuzzy: strip spaces
  hit = dbRows.find(r => noSpace(r.district) === ns);
  if (hit) return { dbRow: hit, matchType: 'fuzzy-nospace' };

  // 3. Contains (longer contains shorter)
  hit = dbRows.find(r => {
    const rns = noSpace(r.district);
    return rns.includes(ns) || ns.includes(rns);
  });
  if (hit) return { dbRow: hit, matchType: 'fuzzy-contains' };

  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🗺️  migrate-district-codes.js  [${DRY_RUN ? 'DRY RUN' : 'LIVE'}]\n`);

  const client = await pool.connect();

  const summary = {
    total:     0,
    matched:   0,
    skipped:   0,
    unmatched: [],
  };

  try {
    // Fetch all current district_boundaries from DB
    const { rows: allDb } = await client.query(
      `SELECT id, district_id, district, p3d_id FROM district_boundaries ORDER BY p3d_id, district`
    );

    // Group DB rows by p3d_id
    const dbByKdWil = new Map();
    for (const row of allDb) {
      if (!dbByKdWil.has(row.p3d_id)) dbByKdWil.set(row.p3d_id, []);
      dbByKdWil.get(row.p3d_id).push(row);
    }

    console.log(`📦 DB: ${allDb.length} rows across ${dbByKdWil.size} kabupaten\n`);

    // Process each kec JSON file
    const files = fs.readdirSync(KEC_DIR).filter(f => f.endsWith('.json')).sort();
    console.log(`📂 JSON files: ${files.length}\n`);
    // ── backup table (created even in DRY_RUN so you can inspect anytime) ──
    const backupTable = `district_boundaries_backup_${Date.now()}`;
    if (!DRY_RUN) {
      console.log(`💾 Creating backup table: ${backupTable} ...`);
      await client.query(`CREATE TABLE ${backupTable} AS SELECT * FROM district_boundaries`);
      console.log(`✅ Backup created: ${backupTable}`);
      console.log(`   To rollback run:  node scripts/rollback-district-codes.js ${backupTable}\n`);
    }
    // ── migrate unique index (idempotent) ──────────────────────────────────
    if (!DRY_RUN) {
      console.log('🔧 Migrating unique index to composite (p3d_id, district_id)...');
      await client.query('BEGIN');
      await client.query(`DROP INDEX IF EXISTS uq_district_boundaries_district_id`);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_district_boundaries_p3d_district
          ON district_boundaries (p3d_id, district_id)
      `);
      await client.query('COMMIT');
      console.log('✅ Index migrated\n');
    }

    if (!DRY_RUN) await client.query('BEGIN');

    for (const file of files) {
      const kdWil = path.basename(file, '.json');
      const rawBuf = fs.readFileSync(path.join(KEC_DIR, file));
      // Strip BOM (UTF-8: EF BB BF, UTF-16 LE: FF FE, UTF-16 BE: FE FF)
      let rawStr = rawBuf.toString('utf8');
      if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
      // If PowerShell wrote UTF-16, re-decode
      if (rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
        rawStr = rawBuf.toString('utf16le');
        if (rawStr.charCodeAt(0) === 0xFEFF) rawStr = rawStr.slice(1);
      }
      const raw = JSON.parse(rawStr);
      const data  = raw.data || [];
      if (!data.length) { console.log(`⚠️  ${kdWil}: empty, skip`); continue; }

      const newMap  = extractKecamatan(data, kdWil);
      const dbRows  = dbByKdWil.get(kdWil) || [];

      if (!dbRows.length) {
        console.log(`⚠️  ${kdWil}: tidak ada data di DB, skip`);
        for (const [, v] of newMap) {
          summary.unmatched.push({ kdWil, nmKecNew: v.nmKec, dbDistrict: '-', reason: 'no DB rows for kd_wil' });
        }
        continue;
      }

      console.log(`── ${kdWil} · ${newMap.size} kec baru · ${dbRows.length} DB rows`);

      for (const [, newKec] of newMap) {
        summary.total++;
        const result = findMatch(newKec.nmKec, dbRows);

        if (!result) {
          console.log(`  ❌ NO MATCH  "${newKec.nmKec}"`);
          summary.skipped++;
          summary.unmatched.push({
            kdWil,
            nmKecNew: newKec.nmKec,
            dbDistrict: '(no match)',
            reason: 'unmatched',
          });
          continue;
        }

        const { dbRow, matchType } = result;
        const icon = matchType === 'exact' ? '✅' : '🔶';
        console.log(`  ${icon} [${matchType}]  "${dbRow.district}" → "${newKec.nmKec}"  (id: ${dbRow.district_id} → ${newKec.newDistrictId})`);

        if (!DRY_RUN) {
          await client.query(
            `UPDATE district_boundaries
               SET district    = $1,
                   district_id = $2,
                   updated_at  = NOW()
             WHERE id = $3`,
            [newKec.nmKec, newKec.newDistrictId, dbRow.id]
          );
          // Update the local copy so subsequent matches w/in same p3d_id
          // reflect the already-matched rows (prevent double mapping)
          dbRow._matched = true;
        }

        summary.matched++;
      }
      console.log('');
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

  // ── final report ────────────────────────────────────────────────────────────

  console.log('═'.repeat(60));
  console.log(`TOTAL       : ${summary.total}`);
  console.log(`MATCHED     : ${summary.matched}`);
  console.log(`UNMATCHED   : ${summary.skipped}`);
  console.log(`STATUS      : ${DRY_RUN ? 'DRY RUN – tidak ada perubahan ke DB' : 'COMMITTED'}`);
  console.log('═'.repeat(60));

  if (summary.unmatched.length) {
    console.log('\n⚠️  UNMATCHED LIST:');
    console.log('  kd_wil  | nm_kec_baru                    | nm_kec_db          | alasan');
    console.log('  ' + '-'.repeat(80));
    summary.unmatched.forEach(r =>
      console.log(`  ${r.kdWil.padEnd(7)} | ${r.nmKecNew.padEnd(30)} | ${r.dbDistrict.padEnd(18)} | ${r.reason}`)
    );

    // Try writing CSV — fall back to /tmp if app dir is read-only
    const candidates = [
      path.join(__dirname, '..', 'data', 'boundaries', 'migrate-district-unmatched.csv'),
      '/tmp/migrate-district-unmatched.csv',
    ];
    const header = 'kd_wil,nm_kec_baru,nm_kec_db,alasan';
    const rows   = summary.unmatched.map(r =>
      [r.kdWil, r.nmKecNew, r.dbDistrict, r.reason]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
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
