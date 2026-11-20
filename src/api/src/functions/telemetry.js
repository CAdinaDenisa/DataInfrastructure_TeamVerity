// Inside src/api/src/functions/telemetry.js
const { app } = require('@azure/functions');

// Temporary in-memory storage (replace with Cosmos DB / Table Storage)
let eventsStore = [];

app.http('telemetry', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        // 1. PHONE SENDS DATA HERE (POST)
        if (request.method === 'POST') {
            const body = await request.json(); // <-- Receives the JSON from the phone!
            
            // Extract sensor values
            const { accelerometer, magnetometer, barometer } = body.sensors;

            // Simple driving advice logic
            let advice = "Normal driving conditions.";
            if (Math.abs(accelerometer.z - 9.81) > 3.0) {
                advice = "Rough road / pothole detected!";
            } else if (Math.abs(accelerometer.x) > 2.5 || Math.abs(accelerometer.y) > 2.5) {
                advice = "Harsh acceleration or sharp turn detected.";
            }

            const record = {
                ...body,
                advice
            };

            eventsStore.push(record);
            return { status: 201, jsonBody: { message: "Saved", record } };
        }

        // 2. WEB DASHBOARD READS DATA HERE (GET)
        if (request.method === 'GET') {
            const ownerId = request.query.get('ownerId');
            const filtered = ownerId 
                ? eventsStore.filter(e => e.ownerId === ownerId) 
                : eventsStore;
            return { status: 200, jsonBody: filtered };
        }
    }
});