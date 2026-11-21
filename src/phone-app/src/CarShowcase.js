import React, { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';

// Imagini pregătite (911-ul decupat + piedestalul randat), toate de aceeași mărime și suprapuse:
//   glowBack  – lumina albastră de pe podea, de sub piedestal (pulsează)
//   stage     – piedestal + mașină + reflexie + umbră (static)
//   glowFront – strălucirea benzii LED de sub buza piedestalului (pulsează)
//   glint     – o sclipire care aleargă pe margine → senzația că piedestalul se învârte
const IMG = {
  glowBack: require('../assets/showroom/glow_back.webp'),
  stage: require('../assets/showroom/stage.webp'),
  glowFront: require('../assets/showroom/glow_front.webp'),
  glint: require('../assets/showroom/glint.png'),
};

// Geometria scenei, în pixelii imaginii originale (1340 × 590).
const G = { W: 1340, H: 590, cx: 670, cy: 387, rx: 565, ry: 96, ledY: 421 };
const SWEEP_MS = 4200; // cât durează o trecere a sclipirii prin fața piedestalului
const PULSE_MS = 2600;

// Traseul sclipirii pe jumătatea din față a elipsei (stânga → față → dreapta), eșantionat.
const N = 24;
const steps = Array.from({ length: N + 1 }, (_, i) => i / N);
const path = (yCenter, ryScale) =>
  steps.map((s) => {
    const t = Math.PI * (0.98 - 0.96 * s);
    return { x: G.cx + G.rx * Math.cos(t), y: yCenter + G.ry * ryScale * Math.sin(t), sin: Math.sin(t) };
  });
const LED_PATH = path(G.ledY, 1);
const RIM_PATH = path(G.cy, 0.982);

function Glint({ progress, pts, k, w, h, strength }) {
  const at = (fn) => progress.interpolate({ inputRange: steps, outputRange: pts.map(fn) });
  return (
    <Animated.Image
      source={IMG.glint}
      resizeMode="stretch"
      style={[
        styles.glint,
        {
          width: w,
          height: h,
          opacity: at((p) => strength * Math.pow(p.sin, 1.5)),
          transform: [
            { translateX: at((p) => p.x * k - w / 2) },
            { translateY: at((p) => p.y * k - h / 2) },
            { scaleX: at((p) => 0.25 + 0.75 * p.sin) },
          ],
        },
      ]}
    />
  );
}

// Piedestal întunecat cu lumină albastră dedesubt; 911-ul stă pe blat.
export default function CarShowcase() {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 36, 460);
  const k = w / G.W;
  const h = G.H * k;

  const [pulse] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const s = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(700),
      ])
    );
    p.start();
    s.start();
    return () => {
      p.stop();
      s.stop();
    };
  }, [pulse, sweep]);

  const backOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const frontOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const layer = { width: w, height: h };

  return (
    <View style={[styles.wrap, layer]} pointerEvents="none">
      <Animated.Image source={IMG.glowBack} resizeMode="stretch" style={[styles.abs, layer, { opacity: backOpacity }]} />
      <Image source={IMG.stage} resizeMode="stretch" style={[styles.abs, layer]} />
      <Animated.Image source={IMG.glowFront} resizeMode="stretch" style={[styles.abs, layer, { opacity: frontOpacity }]} />
      <Glint progress={sweep} pts={RIM_PATH} k={k} w={110 * k} h={16 * k} strength={0.55} />
      <Glint progress={sweep} pts={LED_PATH} k={k} w={170 * k} h={34 * k} strength={1} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', marginTop: 4, marginBottom: 6 },
  abs: { position: 'absolute', left: 0, top: 0 },
  glint: { position: 'absolute', left: 0, top: 0 },
});
