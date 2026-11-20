// Inside src/phone-app/App.js
const sendTelemetry = async (accelData, magData, baroData) => {
  const payload = {
    deviceId: "CAR-01",
    ownerId: "company_A",
    timestamp: new Date().toISOString(),
    sensors: {
      accelerometer: {
        x: accelData.x,
        y: accelData.y,
        z: accelData.z
      },
      magnetometer: {
        x: magData.x,
        y: magData.y,
        z: magData.z,
        heading: Math.round((Math.atan2(magData.y, magData.x) * 180) / Math.PI)
      },
      barometer: {
        pressure: baroData.pressure,
        relativeAltitude: baroData.relativeAltitude || 0
      }
    }
  };

  await fetch("https://<YOUR-AZURE-FUNCTION-URL>/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
};