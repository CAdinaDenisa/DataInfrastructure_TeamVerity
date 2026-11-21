'use strict';
/**
 * Înveliș comun pentru toate endpoint-urile: autentificare, loguri structurate, erori.
 * Fiecare cerere primește un requestId (= invocationId din Azure Functions), întors în header-ul
 * x-request-id și scris în log, ca să găsești cererea în Application Insights / Log stream.
 */
const { authenticate } = require('./auth');
const { getStore } = require('../storage');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param name     numele endpoint-ului (apare în log)
 * @param fn       async ({ request, context, principal, store, log }) => { status?, jsonBody, logFields? }
 * @param options  { auth: true }  auth=false doar pentru /api/health
 */
function endpoint(name, fn, { auth = true } = {}) {
  return async (request, context) => {
    const started = Date.now();
    const requestId = context.invocationId;
    let res;
    let logFields = {};
    try {
      let principal = null;
      if (auth) {
        const a = authenticate(request.headers);
        if (!a.ok) res = { status: a.status, jsonBody: a.jsonBody };
        else principal = a.principal;
      }
      if (!res) {
        res = await fn({ request, context, principal, store: getStore() });
        logFields = res.logFields || {};
        delete res.logFields;
      }
    } catch (err) {
      if (err instanceof HttpError) {
        res = { status: err.status, jsonBody: { error: err.message } };
      } else {
        context.error(JSON.stringify({ endpoint: name, requestId, error: err.message }));
        res = { status: 503, jsonBody: { error: 'Serviciu indisponibil temporar, reîncearcă.' } };
      }
    }
    const status = res.status || 200;
    context.log(JSON.stringify({ endpoint: name, requestId, status, durationMs: Date.now() - started, ...logFields }));
    return { ...res, status, headers: { ...(res.headers || {}), 'x-request-id': requestId } };
  };
}

const intParam = (request, name, def, min, max) =>
  Math.min(Math.max(parseInt(request.query.get(name) || String(def), 10) || def, min), max);

function timeParam(request, name) {
  const v = request.query.get(name);
  if (v && Number.isNaN(Date.parse(v))) throw new HttpError(400, `${name}: timestamp invalid`);
  return v || undefined;
}

module.exports = { endpoint, HttpError, intParam, timeParam };
