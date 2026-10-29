// src/components/glow/EdgeGlow.tsx
// Apple-Intelligence-style glow around the screen edges (Skia shader, adapted from reacticx).
// Drawn on top of everything, never blocks touches. `active` true -> the glow blooms in from the
// bottom and keeps flowing; false -> it fades out and the canvas is removed.
//
// Mounted ONCE at the app root through <GlowOverlay/>. If the shader cannot compile on a phone,
// the plain-SVG glow (SvgGlow.tsx) is shown instead, so the glow is never silently missing.
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Canvas, Fill, Shader } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GLOW_EFFECT, GLOW_PARAMS } from './glowShader';
import SvgGlow from './SvgGlow';
import { GLOW_DEBUG } from '../../services/session/GlowState';

type Props = {
  active: boolean;
  introMs?: number; // bloom-in time
  outroMs?: number; // fade-out time
};

function SkiaGlow({ active, introMs = 1200, outroMs = 700 }: Props) {
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Always holds the latest `active`, so a fade-out that finishes just after the glow was switched
  // on again can never remove the canvas.
  const activeRef = useRef(active);
  activeRef.current = active;

  const intensity = useSharedValue(0);
  const iTime = useSharedValue(0);

  // Drives the flowing colours; only runs while the glow is on screen.
  const frame = useFrameCallback((info) => {
    iTime.value = info.timeSinceFirstFrame / 1000;
  }, false);

  const finishOutro = useCallback(() => {
    if (activeRef.current) return;
    frame.setActive(false);
    setMounted(false);
  }, [frame]);

  useEffect(() => {
    if (active) {
      setMounted(true);
      frame.setActive(true);
      intensity.value = withTiming(1, {
        duration: introMs,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
    } else {
      intensity.value = withTiming(0, { duration: outroMs, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(finishOutro);
      });
    }
  }, [active, introMs, outroMs, frame, intensity, finishOutro]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  }, []);

  const uniforms = useDerivedValue(
    () => ({
      iTime: iTime.value,
      intensity: intensity.value,
      iResolution: [size.width, size.height],
      ...GLOW_PARAMS,
    }),
    [size.width, size.height],
  );

  const visible = mounted && size.width > 0;
  useEffect(() => {
    console.log(`[Glow] skia active=${active} mounted=${mounted} size=${Math.round(size.width)}x${Math.round(size.height)}`);
  }, [active, mounted, size.width, size.height]);

  return (
    <View pointerEvents="none" style={styles.fill} onLayout={onLayout}>
      {visible ? (
        <Canvas style={styles.canvas} pointerEvents="none">
          <Fill>
            <Shader source={GLOW_EFFECT!} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
      {GLOW_DEBUG && visible ? <Text style={styles.debugLabel}>skia shader glow drawn</Text> : null}
    </View>
  );
}

function EdgeGlow(props: Props) {
  // GLOW_EFFECT is decided once at start-up, so this never switches between the two while running.
  return GLOW_EFFECT ? <SkiaGlow {...props} /> : <SvgGlow {...props} />;
}

const styles = StyleSheet.create({
  // Explicit full-screen positioning (StyleSheet.absoluteFillObject is not available on this RN version).
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 },
  canvas: { flex: 1 },
  debugLabel: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 5,
  },
});

export default memo(EdgeGlow);