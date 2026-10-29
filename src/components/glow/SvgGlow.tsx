// src/components/glow/SvgGlow.tsx
// FALLBACK glow, built only from React Native Animated + react-native-svg. EdgeGlow.tsx uses this
// only if the Skia shader cannot compile on a phone. Same props as EdgeGlow.
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { GLOW_DEBUG } from '../../services/session/GlowState';

type Props = {
  active: boolean;
  introMs?: number; // fade-in time
  outroMs?: number; // fade-out time
};

// Colours around the screen: purple left, magenta top-left, red/orange right, pink bottom, blue bottom-left.
const C = {
  purple: '#A35CF0',
  magenta: '#E24BB5',
  red: '#FF4D5E',
  orange: '#FF9A3C',
  pink: '#F5A0E0',
  blue: '#4C7DFF',
  violet: '#8D6BFF',
};

const LAYERS = [
  { id: 'glowA', colors: [C.purple, C.magenta, C.red, C.orange], from: [0, 0], to: [1, 0.35], delay: 0 },
  { id: 'glowB', colors: [C.blue, C.violet, C.magenta, C.red], from: [0, 1], to: [1, 0.2], delay: 600 },
  { id: 'glowC', colors: [C.violet, C.pink, C.orange], from: [0, 0.5], to: [1, 1], delay: 1200 },
];

// Many thin, faint strokes stacked = a smooth soft glow without needing a blur filter.
// Each stroke is centred on the screen edge, so only half of its width is visible: the widest one
// (MAX_W) bleeds about MAX_W / 2 px into the screen. Narrow strokes are denser and stronger, so the
// light is brightest at the edge and fades out inwards. (Checked in a browser render of these values.)
const STROKE_COUNT = 36;
const MAX_W = 104;
const STROKES = Array.from({ length: STROKE_COUNT }, (_, i) => {
  const t = i / (STROKE_COUNT - 1);
  return { w: 4 + (MAX_W - 4) * Math.pow(t, 2.1), o: 0.05 * (1 - 0.7 * t) };
}).reverse(); // widest first, so the narrow bright ones are drawn on top

const CORNER = 44; // match your phone's screen corner radius

function GlowLayer({
  layer,
  width,
  height,
  pulse,
}: {
  layer: (typeof LAYERS)[number];
  width: number;
  height: number;
  pulse: Animated.Value;
}) {
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <Animated.View pointerEvents="none" style={[styles.layer, { opacity }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient
            id={layer.id}
            x1={layer.from[0]}
            y1={layer.from[1]}
            x2={layer.to[0]}
            y2={layer.to[1]}
          >
            {layer.colors.map((c, i) => (
              <Stop key={i} offset={i / (layer.colors.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        {STROKES.map((s, i) => (
          <Rect
            key={i}
            x={2}
            y={2}
            width={Math.max(width - 4, 1)}
            height={Math.max(height - 4, 1)}
            rx={CORNER}
            ry={CORNER}
            fill="none"
            stroke={`url(#${layer.id})`}
            strokeWidth={s.w}
            strokeOpacity={s.o}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

function EdgeGlow({ active, introMs = 900, outroMs = 600 }: Props) {
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fade = useRef(new Animated.Value(0)).current;
  const pulses = useRef(LAYERS.map(() => new Animated.Value(0))).current;

  // fade in / out
  useEffect(() => {
    if (active) {
      setMounted(true);
      Animated.timing(fade, {
        toValue: 1,
        duration: introMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fade, {
        toValue: 0,
        duration: outroMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        // finished is false when the glow was switched on again mid fade-out
        if (finished) setMounted(false);
      });
    }
  }, [active, introMs, outroMs, fade]);

  // the shimmer only runs while the glow is on screen
  useEffect(() => {
    if (!mounted) return;
    const loops = pulses.map((p, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(LAYERS[i].delay),
          Animated.timing(p, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(p, {
            toValue: 0,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [mounted, pulses]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  }, []);

  const visible = mounted && size.width > 0;
  useEffect(() => {
    console.log(`[Glow] svg-fallback active=${active} mounted=${mounted} size=${Math.round(size.width)}x${Math.round(size.height)}`);
  }, [active, mounted, size.width, size.height]);

  return (
    <View pointerEvents="none" style={styles.fill} onLayout={onLayout}>
      {GLOW_DEBUG && visible ? (
        // Stage 2 check: the SVG glow is being drawn (this label is a plain Text, drawn with it).
        <Text style={styles.debugLabel}>svg fallback glow drawn</Text>
      ) : null}
      {visible ? (
        <Animated.View pointerEvents="none" style={[styles.layer, { opacity: fade }]}>
          {LAYERS.map((layer, i) => (
            <GlowLayer key={layer.id} layer={layer} width={size.width} height={size.height} pulse={pulses[i]} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Explicit full-screen positioning (StyleSheet.absoluteFillObject is not available on this RN version).
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
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