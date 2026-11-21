-- =====================================================================
-- 002: statistici per sesiune (rapoarte de cursă pentru dashboard)
-- Actualizate de backend la fiecare lot primit, ca lista de rapoarte să fie o interogare simplă.
-- =====================================================================
ALTER TABLE dbo.sessions ADD
    distance_m      FLOAT NOT NULL CONSTRAINT df_sessions_distance DEFAULT 0, -- distanța orizontală din GPS (fără jitter/salturi)
    anchor_x_m      FLOAT NULL,          -- ultimul punct numărat la distanță (sistem local, m)
    anchor_y_m      FLOAT NULL,
    anchor_ts       DATETIME2(3) NULL,
    max_alt_rel_m   FLOAT NULL,
    min_alt_rel_m   FLOAT NULL,
    max_speed_mps   FLOAT NULL,
    rough_count     INT NOT NULL CONSTRAINT df_sessions_rough DEFAULT 0,  -- loturi cu „drum denivelat / groapă”
    harsh_count     INT NOT NULL CONSTRAINT df_sessions_harsh DEFAULT 0,  -- loturi cu „accelerare/viraj brusc”
    batch_count     INT NOT NULL CONSTRAINT df_sessions_batches DEFAULT 0;
GO

-- distanța parcursă de la începutul sesiunii până la fiecare stare (axa X a graficelor din raport)
ALTER TABLE dbo.device_states ADD distance_m FLOAT NULL;
GO
