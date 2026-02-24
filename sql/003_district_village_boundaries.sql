-- ============================================================
-- district_boundaries & village_boundaries
-- Replica schema that matches the legacy Go/Gin project
--
-- SOURCE OF TRUTH: export-district_boundaries-20251027-63316.csv
--   CSV columns: city_id, district_id, id, p3d_id, province, district,
--                geom.type, geom.coordinates, jmlh_kk
--
-- district_boundaries = kecamatan
--   key columns:
--     id           SERIAL PK
--     city_id      VARCHAR  (nullable in old DB)
--     district_id  VARCHAR  5-digit custom ID e.g. "10103"
--     district     VARCHAR  nama kecamatan  e.g. "GUNUNG SINDUR"
--     p3d_id       VARCHAR  5-digit kab ID  e.g. "10200"  (stored as VARCHAR matching old DB)
--     p3d          VARCHAR  nama kabupaten  e.g. "KABUPATEN BOGOR"  (= province in CSV)
--     jmlh_kk      INTEGER  jumlah kepala keluarga (default 0)
--     geom_postgis GEOMETRY(MultiPolygon, 4326)
--     geom_json    TEXT     pre-built GeoJSON geometry string (for fast serialisation)
--
-- village_boundaries = desa/kelurahan
--   key columns identically structured
-- ============================================================

-- ── district_boundaries ────────────────────────────────────

CREATE TABLE IF NOT EXISTS district_boundaries (
    id           SERIAL PRIMARY KEY,
    city_id      VARCHAR(20),             -- nullable (was null in old DB)
    district_id  VARCHAR(20)  NOT NULL,   -- 5-digit custom ID e.g. "10103"
    district     VARCHAR(255) NOT NULL,   -- kecamatan name  e.g. "GUNUNG SINDUR"
    p3d_id       VARCHAR(20)  NOT NULL,   -- 5-digit kabupaten ID e.g. "10200"
    p3d          VARCHAR(255),            -- kabupaten name  e.g. "KABUPATEN BOGOR"
    jmlh_kk      INTEGER      DEFAULT 0,  -- jumlah kepala keluarga
    geom_postgis GEOMETRY(MultiPolygon, 4326),
    geom_json    TEXT,                    -- ST_AsGeoJSON cache
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- unique on (p3d_id, district_id) — district_id alone is NOT globally unique,
-- uniqueness is only guaranteed within one kabupaten (p3d_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_district_boundaries_p3d_district
    ON district_boundaries (p3d_id, district_id);

-- spatial index
CREATE INDEX IF NOT EXISTS idx_district_boundaries_geom
    ON district_boundaries USING GIST (geom_postgis);

-- lookup by kabupaten
CREATE INDEX IF NOT EXISTS idx_district_boundaries_p3d_id
    ON district_boundaries (p3d_id);

-- ── village_boundaries ─────────────────────────────────────
-- (mirrors the legacy "public.village_boundaries" table used by /desa)

CREATE TABLE IF NOT EXISTS village_boundaries (
    id           SERIAL PRIMARY KEY,
    district_id  VARCHAR(20)  NOT NULL,   -- kode kecamatan  e.g. "3204005"
    village      VARCHAR(255) NOT NULL,   -- nama desa/kelurahan
    unique_code  VARCHAR(20),             -- kode unik desa
    p3d_id       INTEGER,                 -- parent kecamatan p3d_id (optional)
    p3d          VARCHAR(255),            -- nama kecamatan (optional)
    geom_postgis GEOMETRY(MultiPolygon, 4326),
    geom_json    TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_village_boundaries_unique_code
    ON village_boundaries (unique_code)
    WHERE unique_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_village_boundaries_geom
    ON village_boundaries USING GIST (geom_postgis);

CREATE INDEX IF NOT EXISTS idx_village_boundaries_district_id
    ON village_boundaries (district_id);

-- ── helper view for legacy /kecamatan/:kodeKab query ───────
-- Mirrors the SQL used in the Go project exactly.

CREATE OR REPLACE VIEW v_kecamatan_by_kab AS
SELECT
    id,
    p3d_id::text            AS "ID_KAB",
    'JAWA BARAT'            AS "PROVINSI",
    '32'                    AS "PROVNO",
    district_id             AS kd_kecamatan,
    district                AS nm_kecamatan,
    geom_postgis
FROM district_boundaries;
