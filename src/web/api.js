// ======================================================================
//  Verity Drive — Modul API & Stare Flotă
//  Se conectează la backend folosind tokenul și URL-ul din config.js
// ======================================================================

const AUTH_KEY = "verity_drive_auth_v2";
const FLEET_KEY = "verity_drive_fleet_v2";
const DEFAULT_API_BASE = "https://teamverity-api-adina01utcn.azurewebsites.net/api";

export function appConfig() {
  return window.APP_CONFIG || {};
}

export function apiBase() {
  const raw = (appConfig().apiBaseUrl || "").trim();
  if (!raw || raw.includes("<") || raw.includes("aici completez")) {
    return DEFAULT_API_BASE;
  }
  return raw.replace(/\/+$/, "");
}

function presetToken() {
  const raw = (appConfig().apiToken || "").trim();
  if (!raw || raw.includes("<") || raw.includes("PUNE_TOKENUL")) {
    return "";
  }
  return raw;
}

export function loadAuth() {
  const cfg = appConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "{}");
    return {
      ownerId: saved.ownerId || cfg.ownerId || "porsche",
      vehicleId: (saved.vehicleId || cfg.defaultDeviceId || "").trim().toUpperCase(),
      token: presetToken() || saved.token || ""
    };
  } catch (_) {
    return {
      ownerId: cfg.ownerId || "porsche",
      vehicleId: (cfg.defaultDeviceId || "").trim().toUpperCase(),
      token: presetToken()
    };
  }
}

export function saveAuth(auth) {
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      ownerId: auth.ownerId || "porsche",
      vehicleId: (auth.vehicleId || "").trim().toUpperCase(),
      token: auth.token || presetToken()
    })
  );
}

// Flota pornește goală (fără mașini hardcodate) și se populează automat din baza de date
export function loadFleet() {
  try {
    const saved = localStorage.getItem(FLEET_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}

export function saveFleet(fleet) {
  localStorage.setItem(FLEET_KEY, JSON.stringify(fleet));
}

const PALETTE = ["#38bdf8", "#e11d48", "#10b981", "#f59e0b", "#a855f7"];

export function normalizeCar(raw, index = 0) {
  const vin = String(raw.vin || raw.vehicleId || raw.deviceId || "").trim().toUpperCase();
  const isRed = index % 2 === 1 || /taycan|ev|electric/i.test(raw.name || "");
  return {
    vin,
    deviceId: raw.deviceId || vin,
    name: raw.name || `Porsche (${vin.slice(-6) || "Vehicul"})`,
    color: raw.color || PALETTE[index % PALETTE.length],
    imageBase: raw.imageBase || (isRed ? "./assets/porsche-red" : "./assets/porsche-silver"),
    powertrain: raw.powertrain || (isRed ? "ev" : "ice"),
    odometerKm: raw.odometerKm ?? null,
    odometerSetAt: raw.odometerSetAt ?? null,
    oilIntervalKm: raw.oilIntervalKm || (isRed ? 30000 : 15000),
    timingBeltKm: raw.timingBeltKm || 90000
  };
}

// ---------------------------------------------------------------- HTTP helper
async function requestJson(path, { auth, query = {} } = {}) {
  const url = new URL(`${apiBase()}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const headers = { Accept: "application/json" };
  const token = auth?.token || presetToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url.toString(), { method: "GET", headers });
  } catch (_) {
    const err = new Error(`Nu se poate contacta serverul (${apiBase()}).`);
    err.kind = "network";
    throw err;
  }

  if (res.status === 401) {
    const err = new Error("Token respins de server (401 Unauthorized).");
    err.kind = "auth";
    throw err;
  }
  if (res.status === 403) {
    const err = new Error("Acces interzis la acest vehicul (403 Forbidden).");
    err.kind = "forbidden";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Eroare server HTTP ${res.status}`);
    err.kind = "http";
    throw err;
  }

  return res.json();
}

export const api = {
  health() {
    return requestJson("/health");
  },

  telemetry(auth, vehicleId, { limit = 200 } = {}) {
    return requestJson("/telemetry", {
      auth,
      query: {
        ownerId: auth.ownerId || "porsche",
        vehicleId,
        limit
      }
    });
  },

  sessions(auth, { deviceId, vehicleId, limit = 50 } = {}) {
    if (deviceId) {
      return requestJson(`/devices/${encodeURIComponent(deviceId)}/sessions`, {
        auth,
        query: { ownerId: auth.ownerId || "porsche", limit }
      });
    }
    return requestJson("/sessions", {
      auth,
      query: {
        ownerId: auth.ownerId || "porsche",
        vehicleId,
        limit
      }
    });
  },

  sessionDetail(auth, sessionId, deviceId) {
    if (deviceId) {
      return requestJson(
        `/devices/${encodeURIComponent(deviceId)}/sessions/${encodeURIComponent(sessionId)}`,
        { auth, query: { ownerId: auth.ownerId || "porsche" } }
      );
    }
    return requestJson(`/sessions/${encodeURIComponent(sessionId)}`, {
      auth,
      query: { ownerId: auth.ownerId || "porsche" }
    });
  }
};

export async function loadSessionsByVehicle(auth, deviceIds = []) {
  const byVehicle = {};
  const allSessions = [];

  // 1. Încercăm ruta generală /sessions?ownerId=porsche
  try {
    const res = await api.sessions(auth, { vehicleId: auth.vehicleId || undefined, limit: 100 });
    const list = Array.isArray(res) ? res : res?.sessions || res?.items || [];
    allSessions.push(...list);
  } catch (_) {
    // Dacă ruta generală nu e expusă, încercăm per deviceId
    for (const devId of deviceIds) {
      try {
        const res = await api.sessions(auth, { deviceId: devId, limit: 50 });
        const list = Array.isArray(res) ? res : res?.sessions || res?.items || [];
        allSessions.push(...list);
      } catch (_) {}
    }
  }

  for (const raw of allSessions) {
    const vin = String(raw.vehicleId || raw.vin || raw.deviceId || "").trim().toUpperCase();
    if (!vin) continue;
    (byVehicle[vin] ||= []).push({
      sessionId: raw.sessionId || raw.id,
      deviceId: raw.deviceId || vin,
      vehicleId: vin,
      startedAt: raw.startedAt || raw.startedAtUtc || raw.createdAt || new Date().toISOString(),
      endedAt: raw.endedAt || raw.endedAtUtc || null,
      status: raw.status === "active" || raw.status === "live" || !raw.endedAt ? "live" : "done",
      durationSec: Number(raw.durationSec ?? raw.duration ?? 0),
      distanceM: Number(raw.distanceM ?? (raw.distanceKm != null ? raw.distanceKm * 1000 : 0)),
      maxAltRelM: Number(raw.maxAltRelM ?? raw.maxAlt ?? 0),
      stats: raw.stats || null
    });
  }

  Object.values(byVehicle).forEach((list) =>
    list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  );

  return { byVehicle };
}

// ---------------------------------------------------------------- Formatare UI
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtDistance(meters) {
  const m = Number(meters) || 0;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s} sec`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

export function fmtAlt(meters) {
  const v = Number(meters) || 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} m`;
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtKm(n) {
  return Math.round(Number(n) || 0).toLocaleString("ro-RO");
}