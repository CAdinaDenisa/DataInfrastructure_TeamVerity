// Copiază acest fișier în config.js (config.js e ignorat de git) și ajustează dacă e nevoie.
// NU pune tokenul aici: tokenul se lipește în dashboard, în câmpul „Token Secret”,
// și rămâne doar în browserul tău (localStorage).
window.APP_CONFIG = {
  // URL-ul Function App + /api. Local (func start): "http://localhost:7071/api"
  apiBaseUrl: "https://teamverity-api-adina01utcn.azurewebsites.net/api",
  ownerId: "porsche",

  // Doar etichete pentru prima pornire (nume + VIN). Datele vin integral din API.
  // Vehiculele care au curse în bază apar automat, chiar dacă nu sunt în listă.
  vehicles: [
    { name: "Porsche 911 Turbo S", vin: "WP0ZZZ99ZTS392124", color: "#38bdf8", powertrain: "ice" },
    { name: "Porsche Taycan GTS", vin: "WP0ZZZY1ZNSA54819", color: "#e11d48", powertrain: "ev" }
  ],

  pollIntervalMs: 3000,     // cât de des citim telemetria live (GET /telemetry)
  sessionsRefreshMs: 20000  // cât de des reîncărcăm lista de rapoarte
};
