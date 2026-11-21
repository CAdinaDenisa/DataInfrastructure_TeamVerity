# Baza de date (Azure SQL Database / SQL Server)

Script: [`database/migrations/001_init.sql`](../database/migrations/001_init.sql). Se aplică cu `npm run db:migrate` (din `src/backend/api`) (ține evidența în tabela `schema_migrations`, deci poate fi rulat de oricâte ori). Schimbările viitoare = fișiere noi `002_...sql`, niciodată editarea lui `001`.

Același script rulează pe SQL Server 2022 local (Docker) și pe Azure SQL Database: e același motor T-SQL.

## Diagrama

```
devices 1 ── * sessions 1 ── * batches 1 ── * sensor_readings
                                     └──── 1 device_states
```

| Tabelă | Un rând = | Coloane importante |
|---|---|---|
| `devices` | un telefon (o mașină pe dashboard) | `device_id` (PK), `owner_id`, `platform`, `model`, `has_accelerometer/magnetometer/barometer/gps`, `last_seen_at` |
| `sessions` | o înregistrare Start -> Stop | `session_id` (PK), `device_id`, `vehicle_id`, `started_at`, `ref_pressure_hpa` (p0), `origin_lat/lon/alt_m` (originea x/y/z) |
| `batches` | un lot / eveniment primit | `batch_id` (PK = **idempotență la retry**; pentru aplicația actuală = `eventId`), `source_format` (`batch-1.0` sau `event-1`), `sent_at`, `received_at`, `event_count` |
| `sensor_readings` | o citire brută | `event_type`, `ts`, `x/y/z` (accel g, mag uT), `pressure_hpa`, `latitude/longitude/altitude_m/accuracy_m/speed_mps/heading_deg` |
| `device_states` | starea procesată per lot | `pitch_deg/roll_deg/yaw_deg`, `alt_rel_m` + `alt_source`, `pos_x_m/pos_y_m/pos_z_m` + `pos_source`, `advice` |

## De ce așa

- **O singură tabelă pentru toate citirile** (cu coloane goale pentru ce nu se aplică) în loc de 4: graficele interoghează mereu „device + tip + interval de timp”, iar un singur index cluster `(device_id, event_type, ts)` acoperă exact asta. Constrângerile `CHECK` garantează că fiecare tip are coloanele lui completate.
- **`batch_id` ca cheie primară**: dacă telefonul retrimite un lot sau eveniment (retry după timeout), inserarea dă cheie duplicată și API-ul răspunde `200 duplicate` fără să salveze de două ori. Totul (citiri + stare) se scrie într-o tranzacție.
- **`device_states` separat**: scena 3D citește un singur rând (`state`) în loc să recalculeze din sute de citiri.
- **Timp UTC, `DATETIME2(3)`** (milisecunde). Conversia la ora României se face în dashboard.
- **Unități canonice** (g, uT, hPa, m, m/s, grade): backend-ul convertește la intrare, deci baza nu are unități amestecate.

## Volum și limita gratuită

La 10 Hz (accel + mag), barometru 5 Hz și GPS 1 Hz: ~26 rânduri/s, ~94.000 rânduri/oră, cam 10–15 MB/oră. Oferta gratuită Azure SQL are 32 GB, deci ajunge pentru sute de ore de înregistrare. Limita care contează e de **calcul** (vCore-secunde, vezi 04-trecere-azure.md), nu spațiul.

## Interogări utile

```sql
-- ultimele 10 stări ale unui telefon
SELECT TOP 10 ts, pitch_deg, roll_deg, yaw_deg, pos_x_m, pos_y_m, pos_z_m, pos_source
FROM dbo.device_states WHERE device_id = 'phone-sim-01' ORDER BY ts DESC;

-- câte citiri are fiecare senzor într-o sesiune
SELECT event_type, COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts
FROM dbo.sensor_readings WHERE session_id = '<sessionId>' GROUP BY event_type;

-- traseul GPS (pentru hartă)
SELECT ts, latitude, longitude, accuracy_m FROM dbo.sensor_readings
WHERE session_id = '<sessionId>' AND event_type = 'gps' ORDER BY ts;

-- curățenie: șterge o sesiune de test
DELETE r FROM dbo.sensor_readings r WHERE r.session_id = '<sessionId>';
DELETE FROM dbo.device_states WHERE session_id = '<sessionId>';
DELETE FROM dbo.batches WHERE session_id = '<sessionId>';
DELETE FROM dbo.sessions WHERE session_id = '<sessionId>';
```

Local te conectezi cu VS Code (extensia „SQL Server (mssql)”): server `localhost,1433`, user `sa`, parola din `database/docker-compose.yml`, bifezi „Trust server certificate”.
