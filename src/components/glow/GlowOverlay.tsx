// src/components/glow/GlowOverlay.tsx
// The one and only glow in the app. Mount it LAST inside the root view (App.tsx) so it is drawn above
// every screen; it shows whenever GlowState says a transfer is in progress.
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import EdgeGlow from './EdgeGlow';
import { GLOW_DEBUG, setOverlayMounted, useGlowActive } from '../../services/session/GlowState';

export default function GlowOverlay() {
  const active = useGlowActive();

  useEffect(() => {
    setOverlayMounted(true);
    console.log('[Glow] overlay mounted');
    return () => setOverlayMounted(false);
  }, []);

  return (
    <>
      <EdgeGlow active={active} />
      {GLOW_DEBUG && active ? (
        // Stage 1 check: plain views only (no SVG, no animation).
        <View pointerEvents="none" style={styles.debugBorder}>
          <Text style={styles.debugLabel}>glow ON · overlay OK</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  debugBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 6,
    borderColor: '#FF00FF',
    zIndex: 2000,
    elevation: 2000,
    alignItems: 'center',
  },
  debugLabel: {
    marginTop: 24,
    backgroundColor: '#FF00FF',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});