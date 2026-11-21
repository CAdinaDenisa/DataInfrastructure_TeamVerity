import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { cardinal, fieldStrength, headingFromMagnetometer, isFlat, shortestTarget } from './compassMath';

const SIZE = 220;
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5); // o gradație la 5°
const LETTERS = [
  { deg: 0, label: 'N', north: true },
  { deg: 90, label: 'E' },
  { deg: 180, label: 'S' },
  { deg: 270, label: 'V' },
];
const NUMBERS = [30, 60, 120, 150, 210, 240, 300, 330];

// Direcția calculată de sistem (iOS/Android): aceeași sursă ca busola telefonului,
// cu calibrarea și compensarea înclinării făcute de sistemul de operare.
// Dacă nu e disponibilă (permisiune refuzată), revenim la calculul din magnetometru.
function useSystemHeading(active) {
  const [state, setState] = useState({ heading: null, accuracy: null, available: true });
  useEffect(() => {
    if (!active) return undefined;
    let sub = null;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          if (!cancelled) setState((s) => ({ ...s, available: false }));
          return;
        }
        sub = await Location.watchHeadingAsync((h) => {
          if (h && typeof h.magHeading === 'number' && h.magHeading >= 0) {
            setState({ heading: h.magHeading, accuracy: h.accuracy, available: true });
          }
        });
        if (cancelled) sub.remove();
      } catch {
        if (!cancelled) setState((s) => ({ ...s, available: false }));
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);
  return state;
}

// Busolă ca pe telefon: cadranul se rotește, iar indicatorul de sus arată încotro „privește” telefonul.
export default function Compass({ magnetic, acceleration, active }) {
  const system = useSystemHeading(active);
  const fallback = headingFromMagnetometer(magnetic);
  const usingSystem = system.available && system.heading != null;
  const heading = usingSystem ? system.heading : fallback;
  const needsCalibration = usingSystem && system.accuracy != null && system.accuracy <= 1;
  const field = fieldStrength(magnetic);
  const flat = isFlat(acceleration);

  // rotația cadranului (în grade, cumulativă ca să nu sară la trecerea prin 0°)
  const [rot] = useState(() => new Animated.Value(0));
  const last = useRef(0);

  useEffect(() => {
    if (heading == null) return;
    const next = shortestTarget(last.current, -heading);
    last.current = next;
    Animated.timing(rot, {
      toValue: next,
      duration: 450,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [heading, rot]);

  const dialRotate = rot.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'], extrapolate: 'extend' });

  // literele rămân drepte, oricum s-ar roti cadranul
  const upright = useMemo(
    () => (deg) =>
      rot.interpolate({ inputRange: [-360, 360], outputRange: [`${360 - deg}deg`, `${-360 - deg}deg`], extrapolate: 'extend' }),
    [rot]
  );

  const dir = heading != null ? cardinal(heading) : null;
  const interference = field != null && (field < 20 || field > 70);

  return (
    <View style={styles.wrap}>
      <View style={styles.pointer} />
      <View style={[styles.face, !active && styles.inactive]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: dialRotate }] }]}>
          {TICKS.map((d) => {
            const major = d % 30 === 0;
            return (
              <View key={d} style={[StyleSheet.absoluteFill, styles.center, { transform: [{ rotate: `${d}deg` }] }]}>
                <View style={[styles.tick, major && styles.tickMajor, d === 0 && styles.tickNorth]} />
              </View>
            );
          })}
          {NUMBERS.map((d) => (
            <View key={`n${d}`} style={[StyleSheet.absoluteFill, styles.center, { transform: [{ rotate: `${d}deg` }] }]}>
              <Animated.Text style={[styles.number, { transform: [{ rotate: upright(d) }] }]}>{d}</Animated.Text>
            </View>
          ))}
          {LETTERS.map(({ deg, label, north }) => (
            <View key={label} style={[StyleSheet.absoluteFill, styles.center, { transform: [{ rotate: `${deg}deg` }] }]}>
              <Animated.Text style={[styles.letter, north && styles.letterNorth, { transform: [{ rotate: upright(deg) }] }]}>
                {label}
              </Animated.Text>
            </View>
          ))}
        </Animated.View>

        {/* citirea din centru (nu se rotește) */}
        <View style={styles.readout} pointerEvents="none">
          <Text style={styles.degrees}>{heading != null ? `${Math.round(heading)}°` : '—'}</Text>
          <Text style={styles.cardinal}>{dir ? dir.full : active ? 'aștept date…' : 'apasă Start'}</Text>
        </View>
      </View>

      <Text style={styles.meta}>Câmp magnetic {field != null ? `${field.toFixed(1)} µT` : '—'}</Text>
      {active && !flat && !usingSystem ? <Text style={styles.warn}>Ține telefonul orizontal pentru o direcție precisă</Text> : null}
      {needsCalibration || interference ? (
        <Text style={styles.warn}>Busola poate fi imprecisă — mișcă telefonul în formă de 8 și ține-l departe de metal/încărcător</Text>
      ) : null}
      <Text style={styles.source}>{usingSystem ? 'nord magnetic · direcție calculată de sistem' : 'nord magnetic · calculat din magnetometru'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 10 },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#5fa2ff',
    marginBottom: 6,
  },
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#070a10',
    borderWidth: 2,
    borderColor: '#1d2638',
    overflow: 'hidden',
  },
  inactive: { opacity: 0.45 },
  center: { alignItems: 'center' },
  tick: { width: 1, height: 8, marginTop: 6, backgroundColor: '#3a4660' },
  tickMajor: { width: 2, height: 14, backgroundColor: '#8b98b3' },
  tickNorth: { backgroundColor: '#ff4d4d', width: 3, height: 18 },
  number: { marginTop: 24, color: '#6b768c', fontSize: 11 },
  letter: { marginTop: 24, color: '#e4e9f2', fontSize: 18, fontWeight: '600' },
  letterNorth: { color: '#ff4d4d' },
  readout: { position: 'absolute', top: 0, left: 0, width: SIZE - 4, height: SIZE - 4, alignItems: 'center', justifyContent: 'center' },
  degrees: { color: '#fff', fontSize: 40, fontWeight: '200' },
  cardinal: { color: '#5fa2ff', fontSize: 14, letterSpacing: 1, marginTop: 2 },
  meta: { color: '#7f8aa3', fontSize: 12, marginTop: 10 },
  warn: { color: '#ffb547', fontSize: 12, marginTop: 4, textAlign: 'center' },
  source: { color: '#3f4a60', fontSize: 10, marginTop: 4 },
});
