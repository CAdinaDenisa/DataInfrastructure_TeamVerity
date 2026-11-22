'use strict';
/**
 * Stocare în SQL Server / Azure SQL Database prin pachetul `mssql`.
 * Local (SQL_CONNECTION_STRING, user/parolă) și în Azure (SQL_SERVER + Managed Identity) codul e identic;
 * se schimbă doar configurația primită (vezi config.getSqlConfig).
 */
const sql = require('mssql');

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function createSqlStore(sqlConfig) {
  let poolPromise;
  const pool = () => {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(sqlConfig).connect().catch((err) => {
        poolPromise = undefined; // reîncearcă la următoarea cerere (ex. Azure SQL serverless se trezește din pauză)
        throw err;
      });
    }
    return poolPromise;
  };

  return {
    mode: 'sql',

    async ping() {
      await (await pool()).request().query('SELECT 1 AS ok');
      return true;
    },

    async getDevice(deviceId) {
      const r = await (await pool()).request().input('id', sql.NVarChar(64), deviceId)
        .query('SELECT device_id, owner_id FROM dbo.devices WHERE device_id = @id');
      const d = r.recordset[0];
      return d ? { deviceId: d.device_id, ownerId: d.owner_id } : null;
    },

    async listTelemetry({ ownerId, vehicleId, sessionId, from, to, limit = 100 }) {
      const r = await (await pool()).request()
        .input('owner', sql.NVarChar(128), ownerId)
        .input('vehicle', sql.NVarChar(64), vehicleId)
        .input('session_id', sql.NVarChar(64), sessionId ?? null)
        .input('from', sql.DateTime2(3), from ? new Date(from) : null)
        .input('to', sql.DateTime2(3), to ? new Date(to) : null)
        .input('limit', sql.Int, limit)
        .query(`SELECT TOP (@limit) b.batch_id AS b_batch_id, b.device_id AS b_device_id, b.session_id AS b_session_id,
                       b.owner_id AS b_owner_id, b.vehicle_id AS b_vehicle_id, b.captured_at AS b_captured_at,
                       b.received_at AS b_received_at, b.payload_json AS b_payload_json, s.*
                FROM dbo.batches b
                LEFT JOIN dbo.device_states s ON s.batch_id = b.batch_id
                WHERE b.owner_id = @owner AND b.vehicle_id = @vehicle
                  AND (@session_id IS NULL OR b.session_id = @session_id)
                  AND (@from IS NULL OR b.captured_at >= @from) AND (@to IS NULL OR b.captured_at <= @to)
                ORDER BY b.captured_at DESC, b.batch_id DESC`);
      return r.recordset.map((row) => ({
        batchId: row.b_batch_id, deviceId: row.b_device_id, sessionId: row.b_session_id,
        ownerId: row.b_owner_id, vehicleId: row.b_vehicle_id,
        capturedAt: iso(row.b_captured_at), receivedAt: iso(row.b_received_at),
        payload: row.b_payload_json ? JSON.parse(row.b_payload_json) : null,
        state: row.state_id == null ? null : rowToState(row),
      }));
    },

    async getSession(sessionId) {
      const r = await (await pool()).request().input('id', sql.NVarChar(64), sessionId)
        .query('SELECT * FROM dbo.sessions WHERE session_id = @id');
      return r.recordset[0] ? rowToSession(r.recordset[0]) : null;
    },

    async getActiveVehicleSession(vehicleId, activeWindowSec = 30) {
      const r = await (await pool()).request()
        .input('vehicle_id', sql.NVarChar(64), vehicleId)
        .input('sec', sql.Int, activeWindowSec)
        .query(`SELECT TOP 1 session_id, device_id, last_event_at
                FROM dbo.sessions
                WHERE vehicle_id = @vehicle_id
                  AND last_event_at >= DATEADD(second, -@sec, SYSUTCDATETIME())
                ORDER BY last_event_at DESC`);
      const row = r.recordset[0];
      return row ? { sessionId: row.session_id, deviceId: row.device_id, lastEventAt: iso(row.last_event_at) } : null;
    },

    async listSessions(deviceId, limit = 20) {
      const r = await (await pool()).request()
        .input('device_id', sql.NVarChar(64), deviceId).input('limit', sql.Int, limit)
        .query('SELECT TOP (@limit) * FROM dbo.sessions WHERE device_id = @device_id ORDER BY started_at DESC');
      return r.recordset.map(rowToSession);
    },

    async getSessionStates(sessionId, maxRows = 20000) {
      const r = await (await pool()).request()
        .input('session_id', sql.NVarChar(64), sessionId).input('limit', sql.Int, maxRows)
        .query('SELECT TOP (@limit) * FROM dbo.device_states WHERE session_id = @session_id ORDER BY ts ASC');
      return r.recordset.map(rowToState);
    },

    async saveBatch(batch, state, sessionUpdate) {
      const p = await pool();
      const tx = new sql.Transaction(p);
      await tx.begin();
      const req = () => new sql.Request(tx);
      try {
        const first = new Date(batch.events[0].timestamp);
        const last = new Date(batch.events[batch.events.length - 1].timestamp);
        const c = batch.capabilities;
        const d = batch.device || {};

        await req()
          .input('device_id', sql.NVarChar(64), batch.deviceId)
          .input('owner_id', sql.NVarChar(128), batch.ownerId ?? null)
          .input('platform', sql.NVarChar(16), d.platform ?? null)
          .input('model', sql.NVarChar(100), d.model ?? null)
          .input('app_version', sql.NVarChar(32), d.appVersion ?? null)
          .input('acc', sql.Bit, c.accelerometer).input('mag', sql.Bit, c.magnetometer)
          .input('baro', sql.Bit, c.barometer).input('gps', sql.Bit, c.gps)
          .query(`
            MERGE dbo.devices WITH (HOLDLOCK) AS t
            USING (SELECT @device_id AS device_id) AS s ON t.device_id = s.device_id
            WHEN MATCHED THEN UPDATE SET
              owner_id = COALESCE(@owner_id, t.owner_id), platform = COALESCE(@platform, t.platform),
              model = COALESCE(@model, t.model), app_version = COALESCE(@app_version, t.app_version),
              has_accelerometer = @acc, has_magnetometer = @mag, has_barometer = @baro, has_gps = @gps,
              last_seen_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT
              (device_id, owner_id, platform, model, app_version, has_accelerometer, has_magnetometer, has_barometer, has_gps, last_seen_at)
              VALUES (@device_id, @owner_id, @platform, @model, @app_version, @acc, @mag, @baro, @gps, SYSUTCDATETIME());`);

        await req()
          .input('session_id', sql.NVarChar(64), batch.sessionId)
          .input('device_id', sql.NVarChar(64), batch.deviceId)
          .input('vehicle_id', sql.NVarChar(64), batch.vehicleId ?? null)
          .input('first', sql.DateTime2(3), first).input('last', sql.DateTime2(3), last)
          .input('p0', sql.Float, sessionUpdate.refPressureHpa ?? null)
          .input('lat', sql.Float, sessionUpdate.originLat ?? null)
          .input('lon', sql.Float, sessionUpdate.originLon ?? null)
          .input('alt', sql.Float, sessionUpdate.originAltM ?? null)
          .input('dist', sql.Float, sessionUpdate.distanceM ?? 0)
          .input('ax', sql.Float, sessionUpdate.anchorX ?? null)
          .input('ay', sql.Float, sessionUpdate.anchorY ?? null)
          .input('ats', sql.DateTime2(3), sessionUpdate.anchorTs ? new Date(sessionUpdate.anchorTs) : null)
          .input('maxalt', sql.Float, sessionUpdate.maxAltRelM ?? null)
          .input('minalt', sql.Float, sessionUpdate.minAltRelM ?? null)
          .input('maxspd', sql.Float, sessionUpdate.maxSpeedMps ?? null)
          .input('rough', sql.Int, sessionUpdate.roughCount ?? 0)
          .input('harsh', sql.Int, sessionUpdate.harshCount ?? 0)
          .input('nb', sql.Int, sessionUpdate.batchCount ?? 0)
          .query(`
            MERGE dbo.sessions WITH (HOLDLOCK) AS t
            USING (SELECT @session_id AS session_id) AS s ON t.session_id = s.session_id
            WHEN MATCHED THEN UPDATE SET
              last_event_at = CASE WHEN @last > t.last_event_at THEN @last ELSE t.last_event_at END,
              ref_pressure_hpa = COALESCE(t.ref_pressure_hpa, @p0),
              origin_lat = COALESCE(t.origin_lat, @lat), origin_lon = COALESCE(t.origin_lon, @lon),
              origin_alt_m = COALESCE(t.origin_alt_m, @alt), vehicle_id = COALESCE(t.vehicle_id, @vehicle_id),
              started_at = CASE WHEN @first < t.started_at THEN @first ELSE t.started_at END,
              distance_m = @dist, anchor_x_m = @ax, anchor_y_m = @ay, anchor_ts = @ats,
              max_alt_rel_m = @maxalt, min_alt_rel_m = @minalt, max_speed_mps = @maxspd,
              rough_count = @rough, harsh_count = @harsh, batch_count = @nb
            WHEN NOT MATCHED THEN INSERT
              (session_id, device_id, vehicle_id, started_at, last_event_at, ref_pressure_hpa, origin_lat, origin_lon, origin_alt_m,
               distance_m, anchor_x_m, anchor_y_m, anchor_ts, max_alt_rel_m, min_alt_rel_m, max_speed_mps, rough_count, harsh_count, batch_count)
              VALUES (@session_id, @device_id, @vehicle_id, @first, @last, @p0, @lat, @lon, @alt,
               @dist, @ax, @ay, @ats, @maxalt, @minalt, @maxspd, @rough, @harsh, @nb);`);

        try {
          await req()
            .input('batch_id', sql.NVarChar(64), batch.batchId)
            .input('device_id', sql.NVarChar(64), batch.deviceId)
            .input('session_id', sql.NVarChar(64), batch.sessionId)
            .input('v', sql.VarChar(16), batch.sourceFormat || 'batch-1.0')
            .input('sent_at', sql.DateTime2(3), new Date(batch.sentAt))
            .input('n', sql.Int, batch.events.length)
            .input('owner', sql.NVarChar(128), batch.ownerId ?? null)
            .input('vehicle', sql.NVarChar(64), batch.vehicleId ?? null)
            .input('captured', sql.DateTime2(3), last)
            .input('hash', sql.Char(64), batch.payloadHash ?? null)
            .input('payload', sql.NVarChar(sql.MAX), batch.payloadJson ?? null)
            .query(`INSERT INTO dbo.batches (batch_id, device_id, session_id, source_format, sent_at, event_count,
                      owner_id, vehicle_id, captured_at, payload_hash, payload_json)
                    VALUES (@batch_id, @device_id, @session_id, @v, @sent_at, @n, @owner, @vehicle, @captured, @hash, @payload)`);
        } catch (err) {
          if (err.number === 2627 || err.number === 2601) { // cheie duplicată = lot retrimis
            await tx.rollback();
            const ex = await p.request().input('id', sql.NVarChar(64), batch.batchId)
              .query('SELECT payload_hash FROM dbo.batches WHERE batch_id = @id');
            return { duplicate: true, existingHash: ex.recordset[0]?.payload_hash ?? null };
          }
          throw err;
        }

        // Inserare în bloc a citirilor (mult mai rapid decât un INSERT per rând)
        const t = new sql.Table('dbo.sensor_readings');
        t.create = false;
        t.columns.add('device_id', sql.NVarChar(64), { nullable: false });
        t.columns.add('session_id', sql.NVarChar(64), { nullable: false });
        t.columns.add('batch_id', sql.NVarChar(64), { nullable: false });
        t.columns.add('seq', sql.BigInt, { nullable: false });
        t.columns.add('event_type', sql.VarChar(16), { nullable: false });
        t.columns.add('ts', sql.DateTime2(3), { nullable: false });
        for (const col of ['x', 'y', 'z', 'pressure_hpa', 'rel_altitude_m', 'latitude', 'longitude', 'altitude_m',
          'accuracy_m', 'altitude_accuracy_m', 'speed_mps', 'heading_deg']) {
          t.columns.add(col, sql.Float, { nullable: true });
        }
        for (const ev of batch.events) {
          const v = ev.value;
          const vec = ev.eventType === 'accelerometer' || ev.eventType === 'magnetometer';
          const baro = ev.eventType === 'barometer';
          const gps = ev.eventType === 'gps';
          t.rows.add(
            batch.deviceId, batch.sessionId, batch.batchId, ev.seq, ev.eventType, new Date(ev.timestamp),
            vec ? v.x : null, vec ? v.y : null, vec ? v.z : null,
            baro ? v.pressure : null, baro ? v.relativeAltitude ?? null : null,
            gps ? v.latitude : null, gps ? v.longitude : null, gps ? v.altitude ?? null : null,
            gps ? v.accuracy : null, gps ? v.altitudeAccuracy ?? null : null,
            gps ? v.speed ?? null : null, gps ? v.heading ?? null : null,
          );
        }
        // checkConstraints: aplicația are doar SELECT/INSERT/UPDATE (fără ALTER TABLE), vezi grants/
        await req().bulk(t, { checkConstraints: true });

        const o = state.orientation || {};
        await req()
          .input('device_id', sql.NVarChar(64), state.deviceId)
          .input('session_id', sql.NVarChar(64), state.sessionId)
          .input('batch_id', sql.NVarChar(64), state.batchId)
          .input('ts', sql.DateTime2(3), new Date(state.timestamp))
          .input('pitch', sql.Float, o.pitch ?? null).input('roll', sql.Float, o.roll ?? null).input('yaw', sql.Float, o.yaw ?? null)
          .input('alt', sql.Float, state.altitudeRel.value).input('alt_src', sql.VarChar(16), state.altitudeRel.source)
          .input('x', sql.Float, state.position.x).input('y', sql.Float, state.position.y).input('z', sql.Float, state.position.z)
          .input('pos_src', sql.VarChar(16), state.position.source)
          .input('lat', sql.Float, state.gps?.latitude ?? null).input('lon', sql.Float, state.gps?.longitude ?? null)
          .input('acc', sql.Float, state.gps?.accuracy ?? null).input('speed', sql.Float, state.gps?.speed ?? null)
          .input('advice', sql.NVarChar(200), state.advice)
          .input('dist', sql.Float, state.distanceM ?? null)
          .query(`INSERT INTO dbo.device_states
            (device_id, session_id, batch_id, ts, pitch_deg, roll_deg, yaw_deg, alt_rel_m, alt_source,
             pos_x_m, pos_y_m, pos_z_m, pos_source, latitude, longitude, gps_accuracy_m, speed_mps, advice, distance_m)
            VALUES (@device_id, @session_id, @batch_id, @ts, @pitch, @roll, @yaw, @alt, @alt_src,
             @x, @y, @z, @pos_src, @lat, @lon, @acc, @speed, @advice, @dist)`);

        await tx.commit();
        return { duplicate: false };
      } catch (err) {
        try { await tx.rollback(); } catch { /* deja anulată */ }
        throw err;
      }
    },

    async listDevices(ownerId) {
      const r = await (await pool()).request().input('owner', sql.NVarChar(128), ownerId ?? null).query(
        `SELECT device_id, owner_id, display_name, platform, model, has_accelerometer, has_magnetometer,
                has_barometer, has_gps, last_seen_at
         FROM dbo.devices WHERE @owner IS NULL OR owner_id = @owner ORDER BY last_seen_at DESC`);
      return r.recordset.map((d) => ({
        deviceId: d.device_id, ownerId: d.owner_id, displayName: d.display_name, platform: d.platform, model: d.model,
        capabilities: { accelerometer: d.has_accelerometer, magnetometer: d.has_magnetometer, barometer: d.has_barometer, gps: d.has_gps },
        lastSeenAt: iso(d.last_seen_at),
      }));
    },

    async getLatestState(deviceId) {
      const rows = await queryStates(await pool(), deviceId, { limit: 1, latest: true });
      return rows[0] || null;
    },

    async getStates(deviceId, q = {}) {
      return queryStates(await pool(), deviceId, q);
    },

    async getReadings(deviceId, q = {}) {
      const r = await (await pool()).request()
        .input('device_id', sql.NVarChar(64), deviceId)
        .input('type', sql.VarChar(16), q.type ?? null)
        .input('session_id', sql.NVarChar(64), q.sessionId ?? null)
        .input('from', sql.DateTime2(3), q.from ? new Date(q.from) : null)
        .input('to', sql.DateTime2(3), q.to ? new Date(q.to) : null)
        .input('limit', sql.Int, q.limit || 1000)
        .query(`SELECT * FROM (
                  SELECT TOP (@limit) * FROM dbo.sensor_readings
                  WHERE device_id = @device_id AND (@type IS NULL OR event_type = @type)
                    AND (@session_id IS NULL OR session_id = @session_id)
                    AND (@from IS NULL OR ts >= @from) AND (@to IS NULL OR ts <= @to)
                  ORDER BY ts DESC) r ORDER BY ts ASC`);
      return r.recordset.map(rowToEvent);
    },
  };
}

async function queryStates(p, deviceId, q) {
  const r = await p.request()
    .input('device_id', sql.NVarChar(64), deviceId)
    .input('session_id', sql.NVarChar(64), q.sessionId ?? null)
    .input('from', sql.DateTime2(3), q.from ? new Date(q.from) : null)
    .input('to', sql.DateTime2(3), q.to ? new Date(q.to) : null)
    .input('limit', sql.Int, q.limit || 1000)
    .query(`SELECT * FROM (
              SELECT TOP (@limit) * FROM dbo.device_states
              WHERE device_id = @device_id AND (@session_id IS NULL OR session_id = @session_id)
                AND (@from IS NULL OR ts >= @from) AND (@to IS NULL OR ts <= @to)
              ORDER BY ts DESC) s ORDER BY ts ASC`);
  return r.recordset.map(rowToState);
}

function rowToState(s) {
  return {
    deviceId: s.device_id, sessionId: s.session_id, batchId: s.batch_id, timestamp: iso(s.ts),
    orientation: s.pitch_deg == null ? null : { pitch: s.pitch_deg, roll: s.roll_deg, yaw: s.yaw_deg, unit: 'deg' },
    altitudeRel: { value: s.alt_rel_m, unit: 'm', source: s.alt_source },
    position: { x: s.pos_x_m, y: s.pos_y_m, z: s.pos_z_m, unit: 'm', source: s.pos_source, estimated: s.pos_source !== 'gps+barometer' },
    gps: s.latitude == null ? null : { latitude: s.latitude, longitude: s.longitude, accuracy: s.gps_accuracy_m, speed: s.speed_mps },
    advice: s.advice,
    distanceM: s.distance_m ?? null,
  };
}

function rowToSession(row) {
  return {
    sessionId: row.session_id, deviceId: row.device_id, vehicleId: row.vehicle_id,
    startedAt: iso(row.started_at), lastEventAt: iso(row.last_event_at),
    refPressureHpa: row.ref_pressure_hpa, originLat: row.origin_lat, originLon: row.origin_lon, originAltM: row.origin_alt_m,
    distanceM: row.distance_m, anchorX: row.anchor_x_m, anchorY: row.anchor_y_m, anchorTs: row.anchor_ts ? iso(row.anchor_ts) : null,
    maxAltRelM: row.max_alt_rel_m, minAltRelM: row.min_alt_rel_m, maxSpeedMps: row.max_speed_mps,
    roughCount: row.rough_count, harshCount: row.harsh_count, batchCount: row.batch_count,
  };
}

function rowToEvent(r) {
  const base = { eventType: r.event_type, timestamp: iso(r.ts), seq: Number(r.seq), sessionId: r.session_id };
  switch (r.event_type) {
    case 'accelerometer': return { ...base, value: { x: r.x, y: r.y, z: r.z }, unit: 'g' };
    case 'magnetometer': return { ...base, value: { x: r.x, y: r.y, z: r.z }, unit: 'uT' };
    case 'barometer': return { ...base, value: { pressure: r.pressure_hpa, relativeAltitude: r.rel_altitude_m }, unit: 'hPa' };
    default: return {
      ...base, unit: 'wgs84',
      value: { latitude: r.latitude, longitude: r.longitude, altitude: r.altitude_m, accuracy: r.accuracy_m,
        altitudeAccuracy: r.altitude_accuracy_m, speed: r.speed_mps, heading: r.heading_deg },
    };
  }
}

module.exports = { createSqlStore };