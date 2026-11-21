import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import carImage from './src/carImage';
import { API_URL, BASELINE_SAMPLES, CAPTURE_INTERVAL_MS } from './src/config';
import { buildEvent, stableAverage } from './src/event';
import { getDeviceId, newId } from './src/ids';
import * as Queue from './src/queue';
import { createSender } from './src/sender';
import { checkSensors, startSensors } from './src/sensors';

const CHANNELS = [
  { key: 'acceleration', label: 'Accelerometru', unit: 'g' },
  { key: 'magneticField', label: 'Magnetometru', unit: 'µT' },
  { key: 'pressure', label: 'Barometru', unit: 'hPa' },
];

const STATUS_TEXT = { live: 'live', unavailable: 'indisponibil', denied: 'fără permisiune', checking: '…' };

const fmt = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '—');

export default function App() {
  return (
    <SafeAreaProvider>
      <TelemetryScreen />
    </SafeAreaProvider>
  );
}

function TelemetryScreen() {
  // ---------- stare afișată ----------
  const [deviceId, setDeviceId] = useState(null);
  const [sensorStatus, setSensorStatus] = useState({ acceleration: 'checking', magneticField: 'checking', pressure: 'checking' });
  const [readings, setReadings] = useState({ acceleration: null, magneticField: null, pressure: null });
  const [ownerId, setOwnerId] = useState('company_A');
  const [vehicleId, setVehicleId] = useState('CAR-01');
  const [token, setToken] = useState(''); // doar în memorie, niciodată salvat
  const [tracking, setTracking] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [baselineHpa, setBaselineHpa] = useState(null);
  const [queueSnap, setQueueSnap] = useState(Queue.snapshot());
  const [sendStatus, setSendStatus] = useState({ state: 'idle' });
  const [lastAck, setLastAck] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [captured, setCaptured] = useState(0);

  // ---------- referințe (evită valori vechi în callback-uri) ----------
  const latest = useRef({ acceleration: null, magneticField: null, pressure: null });
  const pressureSamples = useRef([]);
  const baselineRef = useRef(null);
  const sessionRef = useRef(null);
  const trackingRef = useRef(false);
  const stopSensorsRef = useRef(null);
  const captureTimer = useRef(null);
  const uiTimer = useRef(null);
  const statusRef = useRef(sensorStatus);
  const deviceRef = useRef(null);
  const contextRef = useRef({ ownerId, vehicleId, token });

  useEffect(() => {
    contextRef.current = { ownerId, vehicleId, token };
  }, [ownerId, vehicleId, token]);

  const sender = useMemo(
    () =>
      createSender({
        getContext: () => contextRef.current,
        onStatus: (s) => {
          setSendStatus(s);
          if (s.state === 'acked') {
            setLastAck(s);
            setLastError(null);
          }
          if (s.state === 'error') setLastError(s.message);
        },
      }),
    []
  );

  // ---------- pornire aplicație ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const id = await getDeviceId();
      deviceRef.current = id;
      const status = await checkSensors();
      statusRef.current = status;
      if (!alive) return;
      setDeviceId(id);
      setSensorStatus(status);
      await Queue.load();
    })();
    const unsub = Queue.subscribe(setQueueSnap);
    return () => {
      alive = false;
      unsub();
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- sesiune și calibrare ----------
  const startNewSession = useCallback(() => {
    sessionRef.current = newId();
    baselineRef.current = null;
    pressureSamples.current = [];
    setSessionId(sessionRef.current);
    setBaselineHpa(null);
  }, []);

  const onReading = useCallback((channel, value) => {
    latest.current[channel] = value;
    // baseline-ul de presiune: o singură dată pe sesiune, din citiri stabile
    if (channel === 'pressure' && baselineRef.current == null) {
      const s = pressureSamples.current;
      s.push(value.value);
      if (s.length > BASELINE_SAMPLES) s.shift();
      if (s.length === BASELINE_SAMPLES) {
        const avg = stableAverage(s);
        if (avg != null) {
          baselineRef.current = avg;
          setBaselineHpa(avg);
        }
      }
    }
  }, []);

  // ---------- captură la 2 secunde ----------
  const capture = useCallback(async () => {
    if (!trackingRef.current) return;
    const status = statusRef.current;
    if (!latest.current.acceleration) return; // accelerometrul e obligatoriu
    if (status.pressure === 'live' && baselineRef.current == null) return; // încă se calibrează presiunea

    if (Queue.snapshot().full) {
      setLastError('Coada e plină (100). Colectarea e în pauză până se trimit evenimentele.');
      sender.drain(); // încearcă să golească coada (după pauza de 30 s, dacă a fost cazul)
      return;
    }

    const { ownerId: o, vehicleId: v } = contextRef.current;
    const event = buildEvent({
      eventId: newId(),
      deviceId: deviceRef.current,
      ownerId: o,
      vehicleId: v,
      sessionId: sessionRef.current,
      now: new Date(),
      readings: latest.current,
      status,
      baselineHpa: baselineRef.current,
    });

    const ok = await Queue.enqueue(event); // salvat ÎNAINTE de trimitere
    if (!ok) {
      setLastError('Coada e plină (100). Colectarea e în pauză până se trimit evenimentele.');
      return;
    }
    setCaptured((n) => n + 1);
    sender.drain();
  }, [sender]);

  // ---------- Start / Stop ----------
  function stopEverything() {
    trackingRef.current = false;
    if (captureTimer.current) clearInterval(captureTimer.current);
    if (uiTimer.current) clearInterval(uiTimer.current);
    captureTimer.current = null;
    uiTimer.current = null;
    if (stopSensorsRef.current) stopSensorsRef.current();
    stopSensorsRef.current = null;
  }

  const onStart = () => {
    if (trackingRef.current) return; // apăsări repetate nu adaugă alți ascultători
    if (!ownerId.trim() || !vehicleId.trim()) {
      setLastError('Completează owner și vehicul.');
      return;
    }
    if (statusRef.current.acceleration !== 'live') {
      setLastError('Accelerometrul nu e disponibil pe acest telefon — nu putem captura.');
      return;
    }
    trackingRef.current = true;
    setTracking(true);
    setLastError(null);
    setCaptured(0);
    latest.current = { acceleration: null, magneticField: null, pressure: null };
    startNewSession();
    stopSensorsRef.current = startSensors(statusRef.current, onReading);
    captureTimer.current = setInterval(capture, CAPTURE_INTERVAL_MS);
    uiTimer.current = setInterval(() => setReadings({ ...latest.current }), 500);
  };

  const onStop = () => {
    stopEverything();
    setTracking(false);
  };

  const onCalibrate = () => {
    if (!trackingRef.current) return;
    startNewSession(); // sesiune nouă + baseline nou; evenimentele deja trimise rămân neschimbate
  };

  const onRetry = () => sender.drain({ manual: true });

  // ---------- derivate pentru afișare ----------
  const pendingHere = queueSnap.items.filter((e) => e.ownerId === ownerId && e.vehicleId === vehicleId).length;
  const pendingOther = queueSnap.size - pendingHere;
  const calibrating = tracking && sensorStatus.pressure === 'live' && baselineHpa == null;

  const sendText = {
    idle: queueSnap.size ? 'În așteptare' : 'Totul trimis',
    sending: `Trimit ${sendStatus.eventId?.slice(0, 8)}…`,
    retrying: `Reîncerc (${sendStatus.attempt}/3)…`,
    acked: 'Confirmat de server',
    error: 'Eroare',
  }[sendStatus.state];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* antet */}
          {carImage ? <Image source={carImage} style={styles.car} resizeMode="contain" /> : null}
          <Text style={styles.brand}>TEAMVERITY</Text>
          <Text style={styles.title}>Telemetrie vehicul</Text>
          <Text style={styles.small}>Device: {deviceId ? deviceId.slice(0, 8) + '…' : '…'}</Text>

          {/* senzori */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Senzori</Text>
            {CHANNELS.map(({ key, label, unit }) => {
              const st = sensorStatus[key];
              const r = readings[key];
              return (
                <View key={key} style={styles.sensorRow}>
                  <View style={styles.sensorHead}>
                    <Text style={styles.sensorLabel}>{label}</Text>
                    <Text style={[styles.badge, st === 'live' ? styles.badgeLive : styles.badgeOff]}>{STATUS_TEXT[st]}</Text>
                  </View>
                  {st !== 'live' ? (
                    <Text style={styles.value}>null — {STATUS_TEXT[st]}</Text>
                  ) : key === 'pressure' ? (
                    <Text style={styles.value}>
                      {fmt(r?.value, 2)} {unit}
                      {baselineHpa != null ? `   baseline ${fmt(baselineHpa, 2)}` : tracking ? '   (calibrare…)' : ''}
                    </Text>
                  ) : (
                    <Text style={styles.value}>
                      x {fmt(r?.x)}  y {fmt(r?.y)}  z {fmt(r?.z)} {unit}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* context */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vehicul</Text>
            <Text style={styles.inputLabel}>Owner (companie)</Text>
            <TextInput style={[styles.input, tracking && styles.inputLocked]} value={ownerId} onChangeText={setOwnerId} editable={!tracking} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.inputLabel}>Vehicul</Text>
            <TextInput style={[styles.input, tracking && styles.inputLocked]} value={vehicleId} onChangeText={setVehicleId} editable={!tracking} autoCapitalize="characters" autoCorrect={false} />
            <Text style={styles.inputLabel}>Token de test</Text>
            <TextInput style={styles.input} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="primit privat de la Adina/Stefana" placeholderTextColor="#55607a" />
          </View>

          {/* controale */}
          <View style={styles.buttons}>
            {!tracking ? (
              <Btn label="Start" onPress={onStart} primary />
            ) : (
              <Btn label="Stop" onPress={onStop} danger />
            )}
            <Btn label="Calibrare / sesiune nouă" onPress={onCalibrate} disabled={!tracking} />
          </View>

          {/* sesiune și coadă */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trimitere</Text>
            <Row k="Stare" v={tracking ? (calibrating ? 'Calibrez presiunea…' : 'Capturez la 2 s') : 'Oprit'} />
            <Row k="Sesiune" v={sessionId ? sessionId.slice(0, 8) + '…' : '—'} />
            <Row k="Capturate în sesiune" v={String(captured)} />
            <Row k="În coadă (acest vehicul)" v={String(pendingHere)} />
            {pendingOther > 0 ? <Row k="În coadă (alt owner/vehicul)" v={String(pendingOther)} /> : null}
            {queueSnap.rejected.length > 0 ? <Row k="Respinse de server" v={String(queueSnap.rejected.length)} warn /> : null}
            <Row k="Expediere" v={sendText} />
            <Row k="Ultima confirmare" v={lastAck ? `${lastAck.eventId.slice(0, 8)}… (${lastAck.status}) ${lastAck.atUtc.slice(11, 19)} UTC` : '—'} />
            <Row k="API" v={API_URL || 'lipsă — setează .env'} warn={!API_URL} />
            {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
            <Btn label="Retry" onPress={onRetry} disabled={queueSnap.size === 0} />
          </View>

          <Text style={styles.footnote}>
            Telefonul ținut în mână e o sursă de senzori, nu un instrument de măsură validat pentru condus. Captura se oprește când aplicația e închisă sau telefonul e blocat.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, primary, danger, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger, disabled && styles.btnDisabled, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function Row({ k, v, warn }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{k}</Text>
      <Text style={[styles.rowV, warn && { color: '#ffb547' }]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070c' },
  content: { padding: 18, paddingBottom: 48 },
  car: { width: '100%', height: 170, marginBottom: 8 },
  brand: { color: '#5fa2ff', letterSpacing: 5, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '300', textAlign: 'center', marginTop: 4 },
  small: { color: '#6b768c', fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  card: { backgroundColor: '#0d1119', borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#182033' },
  cardTitle: { color: '#c8d2e6', fontSize: 13, fontWeight: '600', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  sensorRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#141b2a' },
  sensorHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sensorLabel: { color: '#fff', fontSize: 15 },
  badge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  badgeLive: { backgroundColor: '#0f3d26', color: '#5ee39a' },
  badgeOff: { backgroundColor: '#3a1d1d', color: '#ff8a8a' },
  value: { color: '#9fb0cc', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginTop: 4 },
  inputLabel: { color: '#7f8aa3', fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#070a10', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#1d2638', fontSize: 15 },
  inputLocked: { opacity: 0.5 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, backgroundColor: '#1a2233', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  btnPrimary: { backgroundColor: '#1e6bff' },
  btnDanger: { backgroundColor: '#c0352b' },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowK: { color: '#7f8aa3', fontSize: 13 },
  rowV: { color: '#e4e9f2', fontSize: 13, maxWidth: '58%' },
  error: { color: '#ff8a8a', fontSize: 13, marginTop: 8 },
  footnote: { color: '#4f5a70', fontSize: 11, marginTop: 18, textAlign: 'center', lineHeight: 16 },
});
