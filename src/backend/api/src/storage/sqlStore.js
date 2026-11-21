'use strict';
/**
 * Stocare în SQL Server / Azure SQL Database prin pachetul `mssql`.
 * Local și în Azure codul e identic, se schimbă doar SQL_CONNECTION_STRING.
 */
const sql = require('mssql');

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function createSqlStore(connectionString) {
  let poolPromise;
  const pool = () => {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(connectionString).connect().catch((err) => {
        poolPromise = undefined; // reîncearcă la următoarea cerere (ex. Azure SQL serverless se trezește din pauză)
        throw err;
      });
    }
    return poolPromise;
  };

  return {
    mode: 'sql',

    async getSession(sessionId) {
      const r = await (await pool()).request().input('id', sql.NVarChar(64), sessionId).query(
        `SELECT session_id, device_id, vehicle_id, started_at, ref_pressure_hpa, origin_lat, origin_lon, origin_alt_m
         FROM dbo.sessions WHERE session_id = @id`);
      const row = r.recordset[0];
      if (!row) return null;
      return {
        sessionId: row.session_id, deviceId: row.device_id, vehicleId: row.vehicle_id, startedAt: iso(row.started_at),
        refPressureHpa: row.ref_pressure_hpa, originLat: row.origin_lat, originLon: row.origin_lon, originAltM: row.origin_alt_m,
      };
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
          .query(`
            MERGE dbo.sessions WITH (HOLDLOCK) AS t
            USING (SELECT @session_id AS session_id) AS s ON t.session_id = s.session_id
            WHEN MATCHED THEN UPDATE SET
              last_event_at = CASE WHEN @last > t.last_event_at THEN @last ELSE t.last_event_at END,
              ref_pressure_hpa = COALESCE(t.ref_pressure_hpa, @p0),
              origin_lat = COALESCE(t.origin_lat, @lat), origin_lon = COALESCE(t.origin_lon, @lon),
              origin_alt_m = COALESCE(t.origin_alt_m, @alt), vehicle_id = COALESCE(t.vehicle_id, @vehicle_id)
            WHEN NOT MATCHED THEN INSERT
              (session_id, device_id, vehicle_id, started_at, last_event_at, ref_pressure_hpa, origin_lat, origin_lon, origin_alt_m)
              VALUES (@session_id, @device_id, @vehicle_id, @first, @last, @p0, @lat, @lon, @alt);`);

        try {
          await req()
            .input('batch_id', sql.NVarChar(64), batch.batchId)
            .input('device_id', sql.NVarChar(64), batch.deviceId)
            .input('session_id', sql.NVarChar(64), batch.sessionId)
            .input('v', sql.VarChar(16), batch.sourceFormat || 'batch-1.0')
            .input('sent_at', sql.DateTime2(3), new Date(batch.sentAt))
            .input('n', sql.Int, batch.events.length)
            .query(`INSERT INTO dbo.batches (batch_id, device_id, session_id, source_format, sent_at, event_count)
                    VALUES (@batch_id, @device_id, @session_id, @v, @sent_at, @n)`);
        } catch (err) {
          if (err.number === 2627 || err.number === 2601) { // cheie duplicată = lot retrimis
            await tx.rollback();
            return { duplicate: true };
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
        await req().bulk(t);

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
          .query(`INSERT INTO dbo.device_states
            (device_id, session_id, batch_id, ts, pitch_deg, roll_deg, yaw_deg, alt_rel_m, alt_source,
             pos_x_m, pos_y_m, pos_z_m, pos_source, latitude, longitude, gps_accuracy_m, speed_mps, advice)
            VALUES (@device_id, @session_id, @batch_id, @ts, @pitch, @roll, @yaw, @alt, @alt_src,
             @x, @y, @z, @pos_src, @lat, @lon, @acc, @speed, @advice)`);

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
  return r.recordset.map((s) => ({
    deviceId: s.device_id, sessionId: s.session_id, batchId: s.batch_id, timestamp: iso(s.ts),
    orientation: s.pitch_deg == null ? null : { pitch: s.pitch_deg, roll: s.roll_deg, yaw: s.yaw_deg, unit: 'deg' },
    altitudeRel: { value: s.alt_rel_m, unit: 'm', source: s.alt_source },
    position: { x: s.pos_x_m, y: s.pos_y_m, z: s.pos_z_m, unit: 'm', source: s.pos_source, estimated: s.pos_source !== 'gps+barometer' },
    gps: s.latitude == null ? null : { latitude: s.latitude, longitude: s.longitude, accuracy: s.gps_accuracy_m, speed: s.speed_mps },
    advice: s.advice,
  }));
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
