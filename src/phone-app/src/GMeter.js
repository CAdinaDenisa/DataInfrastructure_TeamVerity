import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { dotPosition, isMoving, tilt, toGravity, totalG } from './accelMath';

const SIZE = 200;
const R = SIZE / 2 - 10; // raza cercului de 1 g
const DOT = 18;

// G-meter: punctul se mișcă spre partea în care e înclinat sau accelerat telefonul.
// Cercul exterior = 1 g, cel din mijloc = 0,5 g.
export default function GMeter({ acceleration, active }) {
  const a = toGravity(acceleration); // vectorul gravitației, pentru bila din cerc
  const raw = acceleration; // valorile trimise la server (convenția backend-ului)
  const t = tilt(a);
  const g = totalG(a);
  const moving = isMoving(a);
  const target = dotPosition(a, R);

  const [pos] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));

  useEffect(() => {
    Animated.timing(pos, {
      toValue: target,
      duration: 450,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [target.x, target.y, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const flat = t && Math.abs(t.pitch) < 3 && Math.abs(t.roll) < 3;

  return (
    <View style={styles.wrap}>
      <View style={[styles.face, !active && styles.inactive]}>
        <View style={[styles.ring, styles.ringOuter]} />
        <View style={[styles.ring, styles.ringMid]} />
        <View style={styles.crossH} />
        <View style={styles.crossV} />
        <Text style={[styles.ringLabel, { top: SIZE / 2 - R - 16 }]}>1 g</Text>
        <Text style={[styles.ringLabel, { top: SIZE / 2 - R / 2 - 16 }]}>0,5 g</Text>
        <Animated.View
          style={[
            styles.dot,
            flat && styles.dotFlat,
            moving && styles.dotMoving,
            { transform: [{ translateX: pos.x }, { translateY: pos.y }] },
          ]}
        />
      </View>

      <View style={styles.stats}>
        <Stat label="Tangaj (față/spate)" value={t ? `${t.pitch.toFixed(1)}°` : '—'} />
        <Stat label="Ruliu (stânga/dreapta)" value={t ? `${t.roll.toFixed(1)}°` : '—'} />
        <Stat label="Accelerație totală" value={g != null ? `${g.toFixed(2)} g` : '—'} />
      </View>

      <Text style={[styles.state, moving && styles.stateMoving, flat && !moving && styles.stateFlat]}>
        {!active ? 'apasă Start' : !a ? 'aștept date…' : moving ? 'Mișcare detectată' : flat ? 'Orizontal ✓' : 'Nemișcat'}
      </Text>
      {raw ? (
        <Text style={styles.raw}>
          x {raw.x.toFixed(3)}  y {raw.y.toFixed(3)}  z {raw.z.toFixed(3)} g
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const C = SIZE / 2;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 10 },
  face: { width: SIZE, height: SIZE, borderRadius: C, backgroundColor: '#070a10', borderWidth: 2, borderColor: '#1d2638' },
  inactive: { opacity: 0.45 },
  ring: { position: 'absolute', borderWidth: 1, borderColor: '#2a3550' },
  ringOuter: { width: R * 2, height: R * 2, borderRadius: R, left: C - R - 2, top: C - R - 2 },
  ringMid: { width: R, height: R, borderRadius: R / 2, left: C - R / 2 - 2, top: C - R / 2 - 2, borderStyle: 'dashed' },
  crossH: { position: 'absolute', left: 8, right: 8, top: C - 2, height: 1, backgroundColor: '#1d2638' },
  crossV: { position: 'absolute', top: 8, bottom: 8, left: C - 2, width: 1, backgroundColor: '#1d2638' },
  ringLabel: { position: 'absolute', left: C + 4, color: '#55607a', fontSize: 10 },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    left: C - DOT / 2 - 2,
    top: C - DOT / 2 - 2,
    backgroundColor: '#5fa2ff',
    shadowColor: '#5fa2ff',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  dotFlat: { backgroundColor: '#5ee39a', shadowColor: '#5ee39a' },
  dotMoving: { backgroundColor: '#ffb547', shadowColor: '#ffb547' },
  stats: { flexDirection: 'row', marginTop: 14, gap: 8 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '300' },
  statLabel: { color: '#7f8aa3', fontSize: 10, marginTop: 2, textAlign: 'center' },
  state: { color: '#7f8aa3', fontSize: 12, marginTop: 10 },
  stateFlat: { color: '#5ee39a' },
  stateMoving: { color: '#ffb547' },
  raw: { color: '#55607a', fontSize: 11, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
