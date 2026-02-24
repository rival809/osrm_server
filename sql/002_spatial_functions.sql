-- ============================================================
-- Spatial Functions for Administrative Boundaries
-- ============================================================

-- ============================================================
-- 1. Get boundaries as GeoJSON FeatureCollection
--    Supports simplification tolerance per zoom level
-- ============================================================

CREATE OR REPLACE FUNCTION fn_get_boundaries_geojson(
    p_level       admin_level_enum,
    p_parent_code VARCHAR DEFAULT NULL,
    p_simplify    DOUBLE PRECISION DEFAULT 0.001,   -- ~100m tolerance
    p_bbox        GEOMETRY DEFAULT NULL              -- optional bounding box filter
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'generated_at', NOW(),
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
    )
    INTO v_result
    FROM (
        SELECT jsonb_build_object(
            'type',       'Feature',
            'id',         b.id,
            'geometry',   ST_AsGeoJSON(
                            ST_SimplifyPreserveTopology(b.geom, p_simplify)
                          )::jsonb,
            'properties', jsonb_build_object(
                            'id',          b.id,
                            'code',        b.code,
                            'name',        b.name,
                            'alt_name',    b.alt_name,
                            'admin_level', b.admin_level,
                            'parent_id',   b.parent_id,
                            'area_km2',    ROUND(b.area_km2::numeric, 2),
                            'population',  b.population,
                            'metadata',    b.metadata
                          )
        ) AS feature
        FROM administrative_boundaries b
        WHERE b.admin_level = p_level
          AND b.is_active = TRUE
          AND (p_parent_code IS NULL OR b.parent_id = (
                SELECT id FROM administrative_boundaries WHERE code = p_parent_code AND is_active = TRUE
              ))
          AND (p_bbox IS NULL OR ST_Intersects(b.geom, p_bbox))
        ORDER BY b.name
    ) sub;

    RETURN v_result;
END;
$$;

-- ============================================================
-- 2. Get single boundary detail as GeoJSON Feature
-- ============================================================

CREATE OR REPLACE FUNCTION fn_get_boundary_detail(
    p_id       INTEGER,
    p_simplify DOUBLE PRECISION DEFAULT 0.0001  -- high detail
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'type',       'Feature',
        'id',         b.id,
        'geometry',   ST_AsGeoJSON(
                        ST_SimplifyPreserveTopology(b.geom, p_simplify)
                      )::jsonb,
        'properties', jsonb_build_object(
                        'id',          b.id,
                        'code',        b.code,
                        'name',        b.name,
                        'alt_name',    b.alt_name,
                        'admin_level', b.admin_level,
                        'parent_id',   b.parent_id,
                        'parent_name', (SELECT name FROM administrative_boundaries WHERE id = b.parent_id),
                        'area_km2',    ROUND(b.area_km2::numeric, 2),
                        'population',  b.population,
                        'metadata',    b.metadata,
                        'children',    (
                            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'id', c.id, 'code', c.code, 'name', c.name
                            ) ORDER BY c.name), '[]'::jsonb)
                            FROM administrative_boundaries c
                            WHERE c.parent_id = b.id AND c.is_active = TRUE
                        ),
                        'bbox',        json_build_array(
                                          ST_XMin(b.geom), ST_YMin(b.geom),
                                          ST_XMax(b.geom), ST_YMax(b.geom)
                                       )
                      )
    )
    INTO v_result
    FROM administrative_boundaries b
    WHERE b.id = p_id AND b.is_active = TRUE;

    RETURN v_result;
END;
$$;

-- ============================================================
-- 3. Find boundary containing a point (reverse lookup)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_find_boundary_at_point(
    p_lon   DOUBLE PRECISION,
    p_lat   DOUBLE PRECISION,
    p_level admin_level_enum DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    code        VARCHAR,
    name        VARCHAR,
    admin_level admin_level_enum,
    area_km2    DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT b.id, b.code, b.name, b.admin_level, b.area_km2
    FROM administrative_boundaries b
    WHERE ST_Contains(b.geom, ST_SetSRID(ST_Point(p_lon, p_lat), 4326))
      AND b.is_active = TRUE
      AND (p_level IS NULL OR b.admin_level = p_level)
    ORDER BY b.area_km2 ASC;  -- smallest first (most specific)
END;
$$;

-- ============================================================
-- 4. Split a boundary polygon using a cut line
--    Creates new child polygons and deactivates the original.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_split_boundary(
    p_boundary_id   INTEGER,
    p_cut_line      GEOMETRY,              -- LineString in SRID 4326
    p_new_names     TEXT[],                -- Names for resulting pieces
    p_new_codes     TEXT[],                -- Codes for resulting pieces
    p_performed_by  VARCHAR DEFAULT 'system'
)
RETURNS TABLE (
    new_id   INTEGER,
    new_code VARCHAR,
    new_name VARCHAR,
    area_km2 DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_source       RECORD;
    v_split_result GEOMETRY;
    v_piece        GEOMETRY;
    v_pieces       GEOMETRY[];
    v_count        INTEGER := 0;
    v_new_ids      INTEGER[];
    v_new_id       INTEGER;
    i              INTEGER;
BEGIN
    -- 1. Fetch source boundary
    SELECT b.id, b.code, b.name, b.admin_level, b.parent_id, b.geom, b.metadata
    INTO v_source
    FROM administrative_boundaries b
    WHERE b.id = p_boundary_id AND b.is_active = TRUE;

    IF v_source IS NULL THEN
        RAISE EXCEPTION 'Boundary ID % not found or inactive', p_boundary_id;
    END IF;

    -- 2. Ensure cut line is a LineString with correct SRID
    IF ST_GeometryType(p_cut_line) != 'ST_LineString' THEN
        RAISE EXCEPTION 'Cut line must be a LineString, got %', ST_GeometryType(p_cut_line);
    END IF;
    p_cut_line := ST_SetSRID(p_cut_line, 4326);

    -- 3. Snap cut line to polygon boundary for clean split
    --    Then use ST_Split; it requires the blade to fully cross the polygon
    v_split_result := ST_Split(
        ST_Snap(v_source.geom, p_cut_line, 0.00001),
        ST_Snap(p_cut_line, v_source.geom, 0.00001)
    );

    -- 4. Extract pieces from GeometryCollection
    FOR i IN 1..ST_NumGeometries(v_split_result) LOOP
        v_piece := ST_GeometryN(v_split_result, i);
        -- Ensure each piece is MultiPolygon
        IF ST_GeometryType(v_piece) = 'ST_Polygon' THEN
            v_piece := ST_Multi(v_piece);
        END IF;
        -- Skip degenerate slivers (< 100 m²)
        IF ST_Area(v_piece::geography) > 100 THEN
            v_pieces := array_append(v_pieces, v_piece);
            v_count := v_count + 1;
        END IF;
    END LOOP;

    IF v_count < 2 THEN
        RAISE EXCEPTION 'Split resulted in fewer than 2 valid pieces (got %). Cut line may not fully cross the polygon.', v_count;
    END IF;

    -- 5. Validate that names/codes arrays match piece count
    IF array_length(p_new_names, 1) IS DISTINCT FROM v_count THEN
        RAISE EXCEPTION 'Expected % names for split pieces, got %', v_count, COALESCE(array_length(p_new_names, 1), 0);
    END IF;
    IF array_length(p_new_codes, 1) IS DISTINCT FROM v_count THEN
        RAISE EXCEPTION 'Expected % codes for split pieces, got %', v_count, COALESCE(array_length(p_new_codes, 1), 0);
    END IF;

    -- 6. Deactivate original boundary
    UPDATE administrative_boundaries SET is_active = FALSE, updated_at = NOW()
    WHERE administrative_boundaries.id = p_boundary_id;

    -- 7. Insert new boundaries
    FOR i IN 1..v_count LOOP
        INSERT INTO administrative_boundaries (
            parent_id, admin_level, code, name, geom, metadata
        ) VALUES (
            v_source.parent_id,
            v_source.admin_level,
            p_new_codes[i],
            p_new_names[i],
            v_pieces[i],
            v_source.metadata || jsonb_build_object('split_from', v_source.code)
        )
        RETURNING administrative_boundaries.id INTO v_new_id;

        v_new_ids := array_append(v_new_ids, v_new_id);
    END LOOP;

    -- 8. Record audit trail
    INSERT INTO boundary_split_history (
        source_id, source_code, source_name, cut_line,
        result_ids, performed_by
    ) VALUES (
        p_boundary_id, v_source.code, v_source.name, p_cut_line,
        v_new_ids, p_performed_by
    );

    -- 9. Return results
    RETURN QUERY
    SELECT b.id, b.code, b.name, ROUND(b.area_km2::numeric, 2)::double precision
    FROM administrative_boundaries b
    WHERE b.id = ANY(v_new_ids)
    ORDER BY b.code;
END;
$$;

-- ============================================================
-- 5. Merge boundaries (reverse of split)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_merge_boundaries(
    p_boundary_ids  INTEGER[],
    p_new_name      VARCHAR,
    p_new_code      VARCHAR,
    p_performed_by  VARCHAR DEFAULT 'system'
)
RETURNS INTEGER   -- returns new merged boundary ID
LANGUAGE plpgsql
AS $$
DECLARE
    v_merged_geom   GEOMETRY;
    v_parent_id     INTEGER;
    v_admin_level   admin_level_enum;
    v_new_id        INTEGER;
BEGIN
    -- Validate all are same level and parent
    SELECT DISTINCT parent_id, admin_level
    INTO v_parent_id, v_admin_level
    FROM administrative_boundaries
    WHERE id = ANY(p_boundary_ids) AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active boundaries found for given IDs';
    END IF;

    -- Union geometries
    SELECT ST_Multi(ST_Union(geom))
    INTO v_merged_geom
    FROM administrative_boundaries
    WHERE id = ANY(p_boundary_ids) AND is_active = TRUE;

    -- Deactivate originals
    UPDATE administrative_boundaries SET is_active = FALSE, updated_at = NOW()
    WHERE id = ANY(p_boundary_ids);

    -- Insert merged boundary
    INSERT INTO administrative_boundaries (parent_id, admin_level, code, name, geom, metadata)
    VALUES (v_parent_id, v_admin_level, p_new_code, p_new_name, v_merged_geom,
            jsonb_build_object('merged_from', p_boundary_ids))
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

SELECT 'Spatial functions created successfully.' AS status;
