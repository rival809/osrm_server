-- ============================================================
-- Administrative Boundaries Schema
-- Supports hierarchical regions: Provinsi → Kota/Kabupaten → Kecamatan
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS hstore;

-- Drop existing objects if re-running
DROP TABLE IF EXISTS boundary_split_history CASCADE;
DROP TABLE IF EXISTS administrative_boundaries CASCADE;
DROP TYPE IF EXISTS admin_level_enum CASCADE;

-- Enum for administrative levels
CREATE TYPE admin_level_enum AS ENUM ('province', 'city', 'district');

-- Main table
CREATE TABLE administrative_boundaries (
    id              SERIAL PRIMARY KEY,
    parent_id       INTEGER REFERENCES administrative_boundaries(id) ON DELETE SET NULL,
    admin_level     admin_level_enum NOT NULL,
    code            VARCHAR(20) NOT NULL UNIQUE,   -- e.g. '32' (Jabar), '32.73' (Bandung), '32.73.01' (Kec. Bandung Wetan)
    name            VARCHAR(255) NOT NULL,
    alt_name        VARCHAR(255),                   -- Nama alternatif / bahasa daerah
    area_km2        DOUBLE PRECISION,               -- Luas wilayah (km²), auto-computed
    population      INTEGER,                        -- Jumlah penduduk (opsional)
    geom            GEOMETRY(MultiPolygon, 4326) NOT NULL,
    metadata        JSONB DEFAULT '{}',             -- Flexible extra fields
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail for polygon splits
CREATE TABLE boundary_split_history (
    id              SERIAL PRIMARY KEY,
    source_id       INTEGER NOT NULL,               -- ID wilayah asli yang dipecah
    source_code     VARCHAR(20) NOT NULL,
    source_name     VARCHAR(255) NOT NULL,
    cut_line        GEOMETRY(LineString, 4326),      -- Garis potong yang digunakan
    result_ids      INTEGER[] NOT NULL,              -- IDs wilayah hasil pecahan
    performed_by    VARCHAR(100) DEFAULT 'system',
    performed_at    TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

-- ============================================================
-- Indexes for performance
-- ============================================================

-- Spatial index (critical for ST_Intersects, ST_Contains queries)
CREATE INDEX idx_boundaries_geom ON administrative_boundaries USING GIST (geom);

-- B-tree indexes for common queries
CREATE INDEX idx_boundaries_parent ON administrative_boundaries (parent_id);
CREATE INDEX idx_boundaries_level ON administrative_boundaries (admin_level);
CREATE INDEX idx_boundaries_code ON administrative_boundaries (code);
CREATE INDEX idx_boundaries_active ON administrative_boundaries (is_active) WHERE is_active = TRUE;

-- Composite index for level + active filtering
CREATE INDEX idx_boundaries_level_active ON administrative_boundaries (admin_level, is_active);

-- ============================================================
-- Trigger: auto-update `updated_at` and `area_km2`
-- ============================================================

CREATE OR REPLACE FUNCTION fn_boundaries_before_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    -- Recalculate area in km² using geography cast (accurate for small regions)
    IF NEW.geom IS DISTINCT FROM OLD.geom THEN
        NEW.area_km2 := ST_Area(NEW.geom::geography) / 1e6;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_boundaries_before_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- Compute area on insert
    NEW.area_km2 := ST_Area(NEW.geom::geography) / 1e6;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_boundaries_update
    BEFORE UPDATE ON administrative_boundaries
    FOR EACH ROW EXECUTE FUNCTION fn_boundaries_before_update();

CREATE TRIGGER trg_boundaries_insert
    BEFORE INSERT ON administrative_boundaries
    FOR EACH ROW EXECUTE FUNCTION fn_boundaries_before_insert();

-- ============================================================
-- Seed: sample data for testing (Jawa Barat hierarchy)
-- ============================================================

-- Provinsi Jawa Barat (simplified rectangle for demo)
INSERT INTO administrative_boundaries (admin_level, code, name, geom) VALUES
('province', '32', 'Jawa Barat',
 ST_Multi(ST_GeomFromGeoJSON('{
   "type": "Polygon",
   "coordinates": [[[105.0,-7.8],[108.8,-7.8],[108.8,-5.9],[105.0,-5.9],[105.0,-7.8]]]
 }')));

-- Kota Bandung (simplified)
INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom) VALUES
((SELECT id FROM administrative_boundaries WHERE code = '32'),
 'city', '32.73', 'Kota Bandung',
 ST_Multi(ST_GeomFromGeoJSON('{
   "type": "Polygon",
   "coordinates": [[[107.55,-6.97],[107.71,-6.97],[107.71,-6.85],[107.55,-6.85],[107.55,-6.97]]]
 }')));

-- Kota Cimahi (simplified)
INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom) VALUES
((SELECT id FROM administrative_boundaries WHERE code = '32'),
 'city', '32.74', 'Kota Cimahi',
 ST_Multi(ST_GeomFromGeoJSON('{
   "type": "Polygon",
   "coordinates": [[[107.51,-6.92],[107.56,-6.92],[107.56,-6.84],[107.51,-6.84],[107.51,-6.92]]]
 }')));

-- Kecamatan Bandung Wetan
INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom) VALUES
((SELECT id FROM administrative_boundaries WHERE code = '32.73'),
 'district', '32.73.01', 'Bandung Wetan',
 ST_Multi(ST_GeomFromGeoJSON('{
   "type": "Polygon",
   "coordinates": [[[107.61,-6.92],[107.63,-6.92],[107.63,-6.90],[107.61,-6.90],[107.61,-6.92]]]
 }')));

-- Kecamatan Coblong
INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom) VALUES
((SELECT id FROM administrative_boundaries WHERE code = '32.73'),
 'district', '32.73.02', 'Coblong',
 ST_Multi(ST_GeomFromGeoJSON('{
   "type": "Polygon",
   "coordinates": [[[107.60,-6.89],[107.63,-6.89],[107.63,-6.87],[107.60,-6.87],[107.60,-6.89]]]
 }')));

SELECT 'Schema created and seeded successfully.' AS status;
