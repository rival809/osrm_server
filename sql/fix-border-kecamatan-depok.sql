-- ============================================================
-- fix-border-kecamatan-depok.sql
--
-- TAJURHALANG dan BOJONGGEDE secara administratif termasuk
-- Kabupaten Bogor (p3d_id='10200'), namun juga muncul dalam
-- data kd_wil Kota Depok (p3d_id='20100') karena berbatasan.
--
-- Solusi: duplikasi row — copy geometry dari kd_wil 10200,
-- insert row baru dengan p3d_id='20100' dan district_id
-- sesuai data referensi (7=TAJURHALANG, 8=BOJONGGEDE).
--
-- Jalankan:
--   docker exec -i postgres psql -U <user> -d <db> < sql/fix-border-kecamatan-depok.sql
-- ============================================================

BEGIN;

-- ── TAJURHALANG ──────────────────────────────────────────────
-- Sumber: 20100.json kd_pos_kd_kecamatan="7"
INSERT INTO district_boundaries (city_id, district_id, district, p3d_id, p3d, jmlh_kk, geom_postgis, geom_json)
SELECT
    city_id,
    '7',
    district,
    '20100',
    (SELECT p3d FROM province_boundaries WHERE p3d_id = '20100' LIMIT 1),
    jmlh_kk,
    geom_postgis,
    geom_json
FROM district_boundaries
WHERE p3d_id = '10200'
  AND UPPER(TRIM(district)) = 'TAJURHALANG'
LIMIT 1
ON CONFLICT (p3d_id, district_id) DO UPDATE
    SET district     = EXCLUDED.district,
        p3d          = EXCLUDED.p3d,
        geom_postgis = EXCLUDED.geom_postgis,
        geom_json    = EXCLUDED.geom_json,
        updated_at   = NOW();

-- ── BOJONGGEDE ───────────────────────────────────────────────
-- Sumber: 20100.json kd_pos_kd_kecamatan="8"
INSERT INTO district_boundaries (city_id, district_id, district, p3d_id, p3d, jmlh_kk, geom_postgis, geom_json)
SELECT
    city_id,
    '8',
    district,
    '20100',
    (SELECT p3d FROM province_boundaries WHERE p3d_id = '20100' LIMIT 1),
    jmlh_kk,
    geom_postgis,
    geom_json
FROM district_boundaries
WHERE p3d_id = '10200'
  AND UPPER(TRIM(district)) = 'BOJONGGEDE'
LIMIT 1
ON CONFLICT (p3d_id, district_id) DO UPDATE
    SET district     = EXCLUDED.district,
        p3d          = EXCLUDED.p3d,
        geom_postgis = EXCLUDED.geom_postgis,
        geom_json    = EXCLUDED.geom_json,
        updated_at   = NOW();

-- Verify
SELECT p3d_id, district_id, district, p3d
FROM district_boundaries
WHERE UPPER(TRIM(district)) IN ('TAJURHALANG', 'BOJONGGEDE')
ORDER BY district, p3d_id;

COMMIT;
