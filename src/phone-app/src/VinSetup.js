import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OWNER, normalizeVin, vinError } from './vehicle';

// Ecranul de la prima pornire: șoferul introduce seria de șasiu (VIN).
// Regulile sunt vizibile de la început, iar mesajul de sub câmp se schimbă pe măsură ce scrie.
export default function VinSetup({ value, onChange, onConfirm }) {
  const typed = normalizeVin(value);
  const err = vinError(typed);
  const ok = !err;
  const hasForbidden = /[IOQ]/.test(typed);

  let feedback = null;
  if (typed.length > 0) {
    if (hasForbidden) feedback = { text: err, kind: 'error' };
    else if (typed.length < 17) feedback = { text: `Mai ai ${17 - typed.length} caractere`, kind: 'info' };
    else feedback = ok ? { text: '✓ Serie de șasiu validă', kind: 'ok' } : { text: err, kind: 'error' };
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.setup}>
          <Text style={styles.brand}>{OWNER.name.toUpperCase()}</Text>
          <Text style={styles.title}>Seria de șasiu</Text>
          <Text style={styles.hint}>Se introduce o singură dată. O găsești în talonul mașinii (rubrica E) sau la baza parbrizului.</Text>

          <View style={styles.rules}>
            <Text style={styles.rulesTitle}>Format acceptat</Text>
            <Text style={styles.rule}>• exact 17 caractere</Text>
            <Text style={styles.rule}>• doar litere și cifre, fără spații</Text>
            <Text style={styles.rule}>• fără literele I, O și Q (folosește cifrele 1 și 0)</Text>
          </View>

          <TextInput
            style={[styles.input, feedback?.kind === 'error' && styles.inputError, ok && styles.inputOk]}
            value={typed}
            onChangeText={(t) => onChange(normalizeVin(t))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={17}
            placeholder="ex. WP0ZZZ99ZTS392124"
            placeholderTextColor="#3a4660"
            returnKeyType="done"
            onSubmitEditing={() => ok && onConfirm()}
          />
          <View style={styles.meta}>
            <Text style={[styles.feedback, feedback?.kind === 'error' && styles.feedbackError, feedback?.kind === 'ok' && styles.feedbackOk]}>
              {feedback?.text ?? ' '}
            </Text>
            <Text style={styles.count}>{typed.length}/17</Text>
          </View>

          <Pressable onPress={onConfirm} disabled={!ok} style={({ pressed }) => [styles.btn, !ok && styles.btnDisabled, pressed && { opacity: 0.7 }]}>
            <Text style={styles.btnText}>Continuă</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070c' },
  setup: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  brand: { color: '#5fa2ff', letterSpacing: 5, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '300', textAlign: 'center', marginTop: 4, marginBottom: 8 },
  hint: { color: '#6b768c', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 16, lineHeight: 18 },
  rules: { alignSelf: 'stretch', backgroundColor: '#0d1119', borderRadius: 12, borderWidth: 1, borderColor: '#182033', padding: 12, marginBottom: 16 },
  rulesTitle: { color: '#c8d2e6', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  rule: { color: '#9fb0cc', fontSize: 13, lineHeight: 20 },
  input: {
    alignSelf: 'stretch',
    backgroundColor: '#070a10',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#1d2638',
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 2,
    fontFamily: mono,
  },
  inputError: { borderColor: '#c0352b' },
  inputOk: { borderColor: '#1f8f55' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 8, gap: 12 },
  feedback: { color: '#7f8aa3', fontSize: 13, flex: 1 },
  feedbackError: { color: '#ff8a8a' },
  feedbackOk: { color: '#5ee39a' },
  count: { color: '#55607a', fontSize: 12 },
  btn: { backgroundColor: '#1e6bff', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 40, minWidth: 180, alignItems: 'center', alignSelf: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
