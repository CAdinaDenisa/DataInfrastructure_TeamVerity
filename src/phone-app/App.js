import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CarShowcase from './src/CarShowcase';
import Compass from './src/Compass';
import GMeter from './src/GMeter';
import { relativeAltitude } from './src/altitude';
import { API_URL, BASELINE_SAMPLES, CAPTURE_INTERVAL_MS } from './src/config';
import { buildEvent, stableAverage } from './src/event';
import VinSetup from './src/VinSetup';
import { MODEL, OWNER, loadVin, normalizeVin, saveVin, vinError } from './src/vehicle';
import { getDeviceId, newId } from './src/ids';
import * as Queue from './src/queue';
import { createSender } from './src/sender';
import { checkSensors, startSensors } from './src/sensors';

const CHANNELS = [
  { key: 'acceleration', label: 'Accelerometru' },
  { key: 'magneticField', label: 'Magnetometru' },
  { key: 'pressure', label: 'Barometru' },
];

const STATUS_TEXT = { live: 'live', unavailable: 'indisponibil', denied: 'fără permisiune', checking: '…' };

const fmt = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '—');

export default function App() {
  return (
    <SafeAreaProvider>
      <CarScreen />
    </SafeAreaProvider>
  );
}

// Telefonul este bordul mașinii:
//  - aplicația deschisă = motor pornit → captura pornește singură, cu o sesiune nouă;
//  - aplicația închisă / în fundal = motor oprit → captura se oprește.
// Șoferul vede doar senzorii. Partea tehnică e în Diagnostic (apăsare lungă pe titlu).
function CarScreen() {
  // ---------- stare afișată ----------
  const [vin, setVin] = useState(undefined); // undefined = se încarcă, null = încă neintrodus
  const [vinInput, setVinInput] = useState('');
  const [phoneId, setPhoneId] = useState(null);
  const [sensorStatus, setSensorStatus] = useState({ acceleration: 'checking', magneticField: 'checking', pressure: 'checking' });
  const [readings, setReadings] = useState({ acceleration: null, magneticField: null, pressure: null });
  const [token, setToken] = useState(''); // doar în memorie, niciodată salvat
  const [showToken, setShowToken] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [sending, setSending] = useState(false); // butonul Start/Stop: trimitem sau nu la Azure
  const [sessionId, setSessionId] = useState(null);
  const [baselineHpa, setBaselineHpa] = useState(null);
  const [queueSnap, setQueueSnap] = useState(Queue.snapshot());
  const [sendStatus, setSendStatus] = useState({ state: 'idle' });
  const [lastAck, setLastAck] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [captured, setCaptured] = useState(0);
  const [diagOpen, setDiagOpen] = useState(false);

  // ---------- referințe (evită valori vechi în callback-uri) ----------
  const latest = useRef({ acceleration: null, magneticField: null, pressure: null });
  const pressureSamples = useRef([]);
  const baselineRef = useRef(null);
  const sessionRef = useRef(null);
  const trackingRef = useRef(false);
  const sendingRef = useRef(false);
  const stopSensorsRef = useRef(null);
  const captureTimer = useRef(null);
  const uiTimer = useRef(null);
  const statusRef = useRef(null); // null până se verifică senzorii
  const contextRef = useRef({ ownerId: OWNER.id, vehicleId: null, token: '' });

  useEffect(() => {
    contextRef.current = { ownerId: OWNER.id, vehicleId: vin ?? null, token };
  }, [vin, token]);

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

  // ---------- sesiune ----------
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
    if (!trackingRef.current || !sendingRef.current) return; // trimiterea e oprită din buton
    const status = statusRef.current;
    const { ownerId, vehicleId } = contextRef.current;
    if (!vehicleId || !latest.current.acceleration) return; // accelerometrul e obligatoriu
    if (status.pressure === 'live' && baselineRef.current == null) return; // încă se calibrează presiunea

    if (Queue.snapshot().full) {
      setLastError('Coada e plină (100). Colectarea e în pauză până se trimit evenimentele.');
      sender.drain();
      return;
    }

    const event = buildEvent({
      eventId: newId(),
      deviceId: vehicleId, // telefonul ESTE mașina: seria de șasiu e ID-ul ei
      ownerId,
      vehicleId,
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

  // ---------- motor pornit / oprit ----------
  const stopEngine = useCallback(() => {
    trackingRef.current = false;
    if (captureTimer.current) clearInterval(captureTimer.current);
    if (uiTimer.current) clearInterval(uiTimer.current);
    captureTimer.current = null;
    uiTimer.current = null;
    if (stopSensorsRef.current) stopSensorsRef.current();
    stopSensorsRef.current = null;
    setTracking(false);
  }, []);

  const startEngine = useCallback(() => {
    if (trackingRef.current) return; // nu pornim de două ori
    if (!statusRef.current || !contextRef.current.vehicleId) return;
    if (statusRef.current.acceleration !== 'live') {
      setLastError('Accelerometrul nu e disponibil pe acest telefon — nu putem captura.');
      return;
    }
    trackingRef.current = true;
    setTracking(true);
    setCaptured(0);
    latest.current = { acceleration: null, magneticField: null, pressure: null };
    startNewSession();
    stopSensorsRef.current = startSensors(statusRef.current, onReading);
    captureTimer.current = setInterval(capture, CAPTURE_INTERVAL_MS);
    uiTimer.current = setInterval(() => setReadings({ ...latest.current }), 500);
    sender.drain(); // trimite ce a rămas din cursele anterioare
  }, [capture, onReading, sender, startNewSession]);

  // ---------- pornire aplicație ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const [id, status, savedVin] = await Promise.all([getDeviceId(), checkSensors(), loadVin()]);
      await Queue.load();
      if (!alive) return;
      statusRef.current = status;
      contextRef.current = { ...contextRef.current, vehicleId: savedVin };
      setPhoneId(id);
      setSensorStatus(status);
      setVin(savedVin);
      if (savedVin) startEngine();
    })();
    const unsub = Queue.subscribe(setQueueSnap);
    return () => {
      alive = false;
      unsub();
      stopEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // aplicația în fundal = motor oprit; revenire = cursă nouă
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') startEngine();
      else if (state === 'background') stopEngine();
    });
    return () => sub.remove();
  }, [startEngine, stopEngine]);

  // ---------- seria de șasiu ----------
  const confirmVin = () => {
    const v = normalizeVin(vinInput);
    if (vinError(v)) return;
    stopEngine();
    contextRef.current = { ...contextRef.current, vehicleId: v };
    setVin(v);
    saveVin(v);
    setDiagOpen(false);
    setTimeout(startEngine, 0); // prima cursă a mașinii
  };

  const changeVin = () => {
    stopEngine();
    setVinInput(vin || '');
    setDiagOpen(false);
    setVin(null); // înapoi la ecranul de introducere
  };

  // ---------- butonul Start / Stop trimitere ----------
  const toggleSending = () => {
    if (sendingRef.current) {
      sendingRef.current = false; // nu mai capturăm; ce e deja în coadă se trimite în continuare
      setSending(false);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setCaptured(0);
    setLastError(null);
    startNewSession(); // fiecare Start = o cursă nouă
    sender.drain();
  };

  const onRecalibrate = () => {
    if (trackingRef.current) startNewSession();
  };

  // ---------- ecrane ----------
  if (vin === undefined) {
    return <SafeAreaView style={styles.root} />;
  }

  if (vin === null) {
    return <VinSetup value={vinInput} onChange={setVinInput} onConfirm={confirmVin} />;
  }

  const alt = relativeAltitude(readings.pressure?.value, baselineHpa);
  const pendingHere = queueSnap.items.filter((e) => e.vehicleId === vin).length;
  const isStale = (e) => e.vehicleId !== vin; // ex. CAR-01 de la testele vechi sau un VIN anterior
  const staleCount = queueSnap.items.filter(isStale).length;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        {/* antet: apăsare lungă = Diagnostic (ascuns pentru șofer) */}
        <Pressable onLongPress={() => setDiagOpen(true)} delayLongPress={800}>
          <CarShowcase />
          <Text style={styles.brand}>{OWNER.name.toUpperCase()} <Text style={styles.brandModel}>{MODEL}</Text></Text>
          <Text style={styles.vinHeader}>{vin}</Text>
        </Pressable>

        {!sending ? (
          <View style={styles.tokenMain}>
            <Text style={styles.inputLabel}>Cheie server (token) – se pune înainte de Pornește</Text>
            <View style={styles.tokenRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={token}
                onChangeText={(t) => setToken(t.trim())}
                secureTextEntry={!showToken}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="lipește aici cheia"
                placeholderTextColor="#55607a"
              />
              <Pressable onPress={() => setShowToken((v) => !v)} style={styles.eye}>
                <Text style={styles.eyeText}>{showToken ? 'Ascunde' : 'Arată'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.tokenSet}>{token ? '🔑 cheie setată' : '🔑 fără cheie'}</Text>
        )}
        <Pressable
          onPress={toggleSending}
          disabled={!tracking}
          style={({ pressed }) => [styles.sendBtn, sending ? styles.sendBtnStop : styles.sendBtnStart, (pressed || !tracking) && styles.sendBtnDim]}
        >
          <Text style={styles.sendBtnText}>{sending ? '■  Oprește trimiterea' : '▶  Pornește trimiterea'}</Text>
        </Pressable>
        <Text style={[styles.sendInfo, sending && styles.sendInfoOn]}>
          {sending
            ? `● Se trimit date la Azure · capturate ${captured} · în coadă ${pendingHere}`
            : pendingHere > 0
              ? `Trimiterea e oprită · ${pendingHere} în coadă se trimit în continuare`
              : 'Trimiterea e oprită · senzorii merg doar pe ecran'}
        </Text>
        {sending && lastError ? <Text style={styles.sendErr}>{lastError}</Text> : null}

        <View style={styles.card}>
          {CHANNELS.map(({ key, label }) => {
            const st = sensorStatus[key];
            const r = readings[key];
            return (
              <View key={key} style={styles.sensorRow}>
                <View style={styles.sensorHead}>
                  <Text style={styles.sensorLabel}>{label}</Text>
                  <Text style={[styles.badge, st === 'live' ? styles.badgeLive : styles.badgeOff]}>{STATUS_TEXT[st]}</Text>
                </View>
                {st !== 'live' ? (
                  <Text style={styles.value}>indisponibil pe acest telefon</Text>
                ) : key === 'acceleration' ? (
                  <GMeter acceleration={r} active={tracking} />
                ) : key === 'magneticField' ? (
                  <Compass magnetic={r} acceleration={readings.acceleration} active={tracking} />
                ) : (
                  <View style={styles.baro}>
                    <View style={styles.baroItem}>
                      <Text style={styles.baroBig}>{alt != null ? `${alt >= 0 ? '+' : ''}${alt.toFixed(1)} m` : '—'}</Text>
                      <Text style={styles.baroLabel}>{baselineHpa != null ? 'altitudine față de pornire' : tracking ? 'calibrare…' : '—'}</Text>
                    </View>
                    <View style={styles.baroItem}>
                      <Text style={styles.baroBig}>{fmt(r?.value, 1)}</Text>
                      <Text style={styles.baroLabel}>presiune (hPa)</Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* ---------- Diagnostic (pentru echipă, nu pentru șofer) ---------- */}
      <Modal visible={diagOpen} animationType="slide" onRequestClose={() => setDiagOpen(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.root}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.diagHeader}>
                  <Text style={styles.diagTitle}>Diagnostic</Text>
                  <Pressable onPress={() => setDiagOpen(false)} style={styles.closeBtn}>
                    <Text style={styles.btnText}>Închide</Text>
                  </Pressable>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Mașina acestui telefon</Text>
                  <Row k="Serie de șasiu" v={vin} />
                  <Btn label="Schimbă seria de șasiu" onPress={changeVin} />
                  <Text style={styles.inputLabel}>Cheie server (DEVICE_API_KEY)</Text>
                  <View style={styles.tokenRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={token}
                      onChangeText={setToken}
                      secureTextEntry={!showToken}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="goală dacă serverul nu cere cheie"
                      placeholderTextColor="#55607a"
                    />
                    <Pressable onPress={() => setShowToken((v) => !v)} style={styles.eye}>
                      <Text style={styles.eyeText}>{showToken ? 'Ascunde' : 'Arată'}</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Trimitere</Text>
                  <Row k="Motor" v={tracking ? 'pornit (capturez la 2 s)' : 'oprit'} />
                  <Row k="Sesiune (cursă)" v={sessionId ? sessionId.slice(0, 8) + '…' : '—'} />
                  <Row k="Capturate în cursă" v={String(captured)} />
                  <Row k="În coadă" v={String(pendingHere)} />
                  {staleCount > 0 ? <Row k="În coadă (teste vechi)" v={String(staleCount)} warn /> : null}
                  {queueSnap.rejected.length > 0 ? <Row k="Respinse de server" v={String(queueSnap.rejected.length)} warn /> : null}
                  <Row k="Expediere" v={sendStatus.state} />
                  <Row k="Ultima confirmare" v={lastAck ? `${lastAck.eventId.slice(0, 8)}… (${lastAck.status}) ${lastAck.atUtc.slice(11, 19)} UTC` : '—'} />
                  <Row k="API" v={API_URL || 'lipsă — setează .env'} warn={!API_URL} />
                  <Row k="deviceId trimis" v={vin} />
                  <Row k="ID intern telefon" v={phoneId ? phoneId.slice(0, 8) + '…' : '—'} />
                  {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
                  <View style={styles.buttons}>
                    <Btn label="Retry" onPress={() => sender.drain({ manual: true })} disabled={queueSnap.size === 0} />
                    <Btn label="Recalibrare altitudine" onPress={onRecalibrate} disabled={!tracking} />
                  </View>
                  {staleCount > 0 ? <Btn label={`Șterge ${staleCount} evenimente de test vechi`} onPress={() => Queue.removeWhere(isStale)} /> : null}
                </View>

                <Text style={styles.footnote}>
                  Telefonul e o sursă de senzori, nu un instrument de măsură validat pentru condus. Captura se oprește când aplicația e închisă sau telefonul e blocat.
                </Text>
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.btn, disabled && styles.btnDisabled, pressed && { opacity: 0.7 }]}>
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
  brandModel: { color: "#e8eefc", fontSize: 15, fontWeight: "700", letterSpacing: 3 },
  title: { color: '#fff', fontSize: 26, fontWeight: '300', textAlign: 'center', marginTop: 4, marginBottom: 8 },
  vinHeader: { color: '#6b768c', fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 8, letterSpacing: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sendBtn: { alignSelf: 'center', minWidth: 240, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 26, alignItems: 'center', marginTop: 6 },
  sendBtnStart: { backgroundColor: '#1e6bff' },
  sendBtnStop: { backgroundColor: '#c0392b' },
  sendBtnDim: { opacity: 0.6 },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  sendInfo: { color: '#6b768c', fontSize: 12, textAlign: 'center', marginTop: 8 },
  sendInfoOn: { color: '#5ee39a' },
  sendErr: { color: '#ffb36b', fontSize: 12, textAlign: 'center', marginTop: 4 },
  btnPrimary: { backgroundColor: '#1e6bff', marginTop: 16 },
  card: { backgroundColor: '#0d1119', borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#182033' },
  cardTitle: { color: '#c8d2e6', fontSize: 13, fontWeight: '600', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  sensorRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#141b2a' },
  sensorHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sensorLabel: { color: '#fff', fontSize: 15 },
  badge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  badgeLive: { backgroundColor: '#0f3d26', color: '#5ee39a' },
  badgeOff: { backgroundColor: '#3a1d1d', color: '#ff8a8a' },
  value: { color: '#9fb0cc', fontSize: 13, marginTop: 4 },
  baro: { flexDirection: 'row', marginTop: 10 },
  baroItem: { flex: 1, alignItems: 'center' },
  baroBig: { color: '#fff', fontSize: 26, fontWeight: '200' },
  baroLabel: { color: '#7f8aa3', fontSize: 11, marginTop: 2 },
  diagHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  diagTitle: { color: '#fff', fontSize: 22, fontWeight: '300' },
  closeBtn: { backgroundColor: '#1a2233', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  inputLabel: { color: '#7f8aa3', fontSize: 12, marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#070a10', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#1d2638', fontSize: 15 },
  tokenMain: { marginTop: 4, marginBottom: 6 },
  tokenSet: { color: '#6b768c', fontSize: 12, textAlign: 'center', marginBottom: 2 },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eye: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1a2233' },
  eyeText: { color: '#c8d2e6', fontSize: 13, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, backgroundColor: '#1a2233', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowK: { color: '#7f8aa3', fontSize: 13 },
  rowV: { color: '#e4e9f2', fontSize: 13, maxWidth: '58%' },
  error: { color: '#ff8a8a', fontSize: 13, marginTop: 8 },
  footnote: { color: '#4f5a70', fontSize: 11, marginTop: 18, textAlign: 'center', lineHeight: 16 },
});
