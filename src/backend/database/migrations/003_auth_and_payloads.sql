-- =====================================================================
-- 003: firmă/vehicul + conținutul original pe fiecare lot
--  - owner_id / vehicle_id: filtrare și autorizare per firmă (GET /api/telemetry?ownerId=&vehicleId=)
--  - captured_at: momentul citirilor (ultimul timestamp din lot), pentru „latest” și istoric
--  - payload_hash: SHA-256 al JSON-ului primit -> 409 dacă același id vine cu alt conținut
--  - payload_json: evenimentul original, returnat dashboard-ului exact cum l-a trimis telefonul
-- =====================================================================
ALTER TABLE dbo.batches ADD
    owner_id      NVARCHAR(128) NULL,
    vehicle_id    NVARCHAR(64)  NULL,
    captured_at   DATETIME2(3)  NULL,
    payload_hash  CHAR(64)      NULL,
    payload_json  NVARCHAR(MAX) NULL;
GO

ALTER TABLE dbo.batches ADD CONSTRAINT ck_batches_payload_json CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1);
CREATE INDEX ix_batches_owner_vehicle_captured ON dbo.batches (owner_id, vehicle_id, captured_at DESC, batch_id);
GO
