-- =====================================================================
-- Porsche Hecaton - schema inițială (T-SQL)
-- Rulează identic pe SQL Server 2022 local (Docker) și pe Azure SQL Database.
-- Toate timestamp-urile sunt UTC, DATETIME2(3) = precizie de milisecunde.
-- Unități canonice: accelerație g, câmp magnetic uT, presiune hPa,
-- distanțe/altitudini m, viteză m/s, unghiuri grade.
-- =====================================================================

-- Telefoanele (o mașină 3D pe dashboard = un device)
CREATE TABLE dbo.devices (
    device_id         NVARCHAR(64)  NOT NULL CONSTRAINT pk_devices PRIMARY KEY,
    owner_id          NVARCHAR(128) NULL,
    display_name      NVARCHAR(100) NULL,
    platform          NVARCHAR(16)  NULL,
    model             NVARCHAR(100) NULL,
    app_version       NVARCHAR(32)  NULL,
    has_accelerometer BIT NOT NULL CONSTRAINT df_devices_acc  DEFAULT 0,
    has_magnetometer  BIT NOT NULL CONSTRAINT df_devices_mag  DEFAULT 0,
    has_barometer     BIT NOT NULL CONSTRAINT df_devices_baro DEFAULT 0,
    has_gps           BIT NOT NULL CONSTRAINT df_devices_gps  DEFAULT 0,
    created_at        DATETIME2(3) NOT NULL CONSTRAINT df_devices_created DEFAULT SYSUTCDATETIME(),
    last_seen_at      DATETIME2(3) NULL
);
CREATE INDEX ix_devices_owner ON dbo.devices (owner_id);
GO

-- O înregistrare (Start -> Stop). Ține referințele pentru poziția 3D.
CREATE TABLE dbo.sessions (
    session_id        NVARCHAR(64) NOT NULL CONSTRAINT pk_sessions PRIMARY KEY,
    device_id         NVARCHAR(64) NOT NULL CONSTRAINT fk_sessions_device REFERENCES dbo.devices (device_id),
    vehicle_id        NVARCHAR(64) NULL,       -- mașina aleasă în aplicație (ex. CAR-01)
    started_at        DATETIME2(3) NOT NULL,
    last_event_at     DATETIME2(3) NOT NULL,
    ref_pressure_hpa  FLOAT NULL,   -- p0: altitudinea relativă = 0 aici
    origin_lat        FLOAT NULL,   -- originea sistemului local x/y (primul fix GPS bun)
    origin_lon        FLOAT NULL,
    origin_alt_m      FLOAT NULL
);
CREATE INDEX ix_sessions_device ON dbo.sessions (device_id, started_at DESC);
GO

-- Un rând per lot primit. Cheia primară pe batch_id = idempotență la retry.
CREATE TABLE dbo.batches (
    batch_id          NVARCHAR(64) NOT NULL CONSTRAINT pk_batches PRIMARY KEY,
    device_id         NVARCHAR(64) NOT NULL CONSTRAINT fk_batches_device  REFERENCES dbo.devices (device_id),
    session_id        NVARCHAR(64) NOT NULL CONSTRAINT fk_batches_session REFERENCES dbo.sessions (session_id),
    source_format     VARCHAR(16)  NOT NULL,   -- batch-1.0 (lot) | event-1 (formatul aplicației actuale)
    sent_at           DATETIME2(3) NOT NULL,
    received_at       DATETIME2(3) NOT NULL CONSTRAINT df_batches_received DEFAULT SYSUTCDATETIME(),
    event_count       INT NOT NULL
);
CREATE INDEX ix_batches_session ON dbo.batches (session_id, sent_at);
GO

-- Citirile brute, toți senzorii într-o singură tabelă.
-- Coloanele folosite depind de event_type (vezi constrângerile CHECK).
CREATE TABLE dbo.sensor_readings (
    reading_id        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_sensor_readings PRIMARY KEY NONCLUSTERED,
    device_id         NVARCHAR(64) NOT NULL,
    session_id        NVARCHAR(64) NOT NULL,
    batch_id          NVARCHAR(64) NOT NULL CONSTRAINT fk_readings_batch REFERENCES dbo.batches (batch_id),
    seq               BIGINT       NOT NULL,
    event_type        VARCHAR(16)  NOT NULL,
    ts                DATETIME2(3) NOT NULL,
    -- accelerometer (g) / magnetometer (uT)
    x                 FLOAT NULL,
    y                 FLOAT NULL,
    z                 FLOAT NULL,
    -- barometer
    pressure_hpa      FLOAT NULL,
    rel_altitude_m    FLOAT NULL,   -- doar iOS
    -- gps (WGS84)
    latitude          FLOAT NULL,
    longitude         FLOAT NULL,
    altitude_m        FLOAT NULL,
    accuracy_m        FLOAT NULL,
    altitude_accuracy_m FLOAT NULL,
    speed_mps         FLOAT NULL,
    heading_deg       FLOAT NULL,
    CONSTRAINT ck_readings_type CHECK (event_type IN ('accelerometer', 'magnetometer', 'barometer', 'gps')),
    CONSTRAINT ck_readings_vector CHECK (event_type NOT IN ('accelerometer', 'magnetometer') OR (x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL)),
    CONSTRAINT ck_readings_baro   CHECK (event_type <> 'barometer' OR pressure_hpa BETWEEN 300 AND 1100),
    CONSTRAINT ck_readings_gps    CHECK (event_type <> 'gps' OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND accuracy_m >= 0)),
    CONSTRAINT uq_readings_batch_seq UNIQUE (batch_id, seq)
);
-- Index cluster pe (device, tip, timp): exact interogarea graficelor din dashboard.
CREATE CLUSTERED INDEX cx_readings_device_type_ts ON dbo.sensor_readings (device_id, event_type, ts);
CREATE INDEX ix_readings_session ON dbo.sensor_readings (session_id, event_type, ts);
GO

-- Starea procesată, un rând per lot: ce citește scena 3D.
CREATE TABLE dbo.device_states (
    state_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_device_states PRIMARY KEY NONCLUSTERED,
    device_id         NVARCHAR(64) NOT NULL,
    session_id        NVARCHAR(64) NOT NULL,
    batch_id          NVARCHAR(64) NOT NULL CONSTRAINT fk_states_batch REFERENCES dbo.batches (batch_id),
    ts                DATETIME2(3) NOT NULL,
    pitch_deg         FLOAT NULL,
    roll_deg          FLOAT NULL,
    yaw_deg           FLOAT NULL,
    alt_rel_m         FLOAT NULL,
    alt_source        VARCHAR(16) NOT NULL,   -- barometer | gps | none
    pos_x_m           FLOAT NULL,             -- est
    pos_y_m           FLOAT NULL,             -- nord
    pos_z_m           FLOAT NULL,             -- sus
    pos_source        VARCHAR(16) NOT NULL,   -- gps+barometer | gps | barometer | none
    latitude          FLOAT NULL,
    longitude         FLOAT NULL,
    gps_accuracy_m    FLOAT NULL,
    speed_mps         FLOAT NULL,
    advice            NVARCHAR(200) NULL,
    CONSTRAINT uq_states_batch UNIQUE (batch_id)
);
CREATE CLUSTERED INDEX cx_states_device_ts ON dbo.device_states (device_id, ts);
GO
