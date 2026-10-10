CREATE TABLE sessions (
    session_key INTEGER PRIMARY KEY,
    circuit_key VARCHAR(100),
    session_name VARCHAR(100),
    session_type VARCHAR(50),
    year INTEGER,
    date_start TIMESTAMPTZ,
    date_end TIMESTAMPTZ
);

CREATE TABLE position_samples (
    session_key INTEGER NOT NULL,
    driver_number INTEGER NOT NULL,
    sample_time_ms BIGINT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL,

    PRIMARY KEY (session_key, driver_number, sample_time_ms),

    CONSTRAINT fk_position_samples_session
        FOREIGN KEY (session_key)
        REFERENCES sessions(session_key)
);

CREATE INDEX idx_position_samples_driver_time
    ON position_samples (session_key, driver_number, sample_time_ms);

CREATE TABLE circuit_geometries (
    circuit_key VARCHAR(100) PRIMARY KEY,
    coordinate_system VARCHAR(100) NOT NULL,
    unit_meters DOUBLE PRECISION NOT NULL,
    closed BOOLEAN NOT NULL,
    width_meters DOUBLE PRECISION,

    laps_used INTEGER NOT NULL,
    sigma_meters DOUBLE PRECISION NOT NULL,
    step_meters DOUBLE PRECISION NOT NULL
);

CREATE TABLE circuit_geometry_points (
    circuit_key VARCHAR(100) NOT NULL,
    point_index INTEGER NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL,

    PRIMARY KEY (circuit_key, point_index),

    CONSTRAINT fk_geometry_points_circuit
        FOREIGN KEY (circuit_key)
        REFERENCES circuit_geometries(circuit_key)
        ON DELETE CASCADE
);

CREATE TABLE circuit_geometry_sessions (
    circuit_key VARCHAR(100) NOT NULL,
    session_key INTEGER NOT NULL,

    PRIMARY KEY (circuit_key, session_key),

    CONSTRAINT fk_geometry_sessions_geometry
        FOREIGN KEY (circuit_key)
        REFERENCES circuit_geometries(circuit_key)
        ON DELETE CASCADE,

    CONSTRAINT fk_geometry_sessions_session
        FOREIGN KEY (session_key)
        REFERENCES sessions(session_key)
);
