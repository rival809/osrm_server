-- ============================================================
-- province_boundaries
-- Replica of public.province_boundaries from the legacy Go/Gin project.
--
-- SOURCE: data/boundaries/jabar.json  (FeatureCollection)
--   properties: OBJECTID, KABKOT, ID_KAB, PROVINSI, PROVNO, KABKOTNO
--
-- Maps to Go struct:
--   id       → OBJECTID
--   p3d_id   → ID_KAB  e.g. "10200"   (5-digit custom kab/kota ID)
--   p3d      → KABKOT  e.g. "Kab. Bogor (Cibinong)"
--   geom_postgis → geometry(MultiPolygon, 4326)
-- ============================================================

CREATE TABLE IF NOT EXISTS province_boundaries (
    id           INTEGER      PRIMARY KEY,   -- OBJECTID from GeoJSON
    p3d_id       VARCHAR(20)  NOT NULL,      -- 5-digit kab/kota ID e.g. "10200"
    p3d          VARCHAR(255) NOT NULL,      -- kabupaten/kota name e.g. "Kab. Bogor (Cibinong)"
    geom_postgis GEOMETRY(MultiPolygon, 4326),
    geom_json    TEXT,                       -- ST_AsGeoJSON cache
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- unique on p3d_id for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_province_boundaries_p3d_id
    ON province_boundaries (p3d_id);

-- spatial index
CREATE INDEX IF NOT EXISTS idx_province_boundaries_geom
    ON province_boundaries USING GIST (geom_postgis);
