// src/components/glow/EdgeGlow.tsx
// Apple-Intelligence-style glow around the screen edges. Drawn on top of the live screen,
// never blocks touches. `active` true -> the glow blooms in from the bottom and keeps
// flowing; false -> it fades out smoothly and the canvas is removed.
import React, { memo, useCallback, useEffect, useState } from 'react';
import { Alert, LayoutChangeEvent, StyleSheet, View } from 'react-native';
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

type Props = {
  active: boolean;
  introMs?: number; // bloom-in time
  outroMs?: number; // fade-out time
};

function EdgeGlow({ active, introMs = 1200, outroMs = 700 }: Props) {
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!GLOW_EFFECT) Alert.alert('Glow', 'The glow shader failed to compile on this phone.');
  }, []);

  const intensity = useSharedValue(0);
  const iTime = useSharedValue(0);

  // Drives the flowing colours; only runs while the glow is on screen.
  const frame = useFrameCallback((info) => {
    iTime.value = info.timeSinceFirstFrame / 1000;
  }, false);

  const finishOutro = useCallback(() => {
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

  return (
    <View pointerEvents="none" style={styles.fill} onLayout={onLayout}>
      {mounted && GLOW_EFFECT && size.width > 0 ? (
        <Canvas style={styles.canvas} pointerEvents="none">
          <Fill>
            <Shader source={GLOW_EFFECT} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  canvas: { flex: 1 },
});

export default memo(EdgeGlow);