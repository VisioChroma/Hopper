// src/components/HandHint.tsx
// Text-free feedback for hand gestures. Shows what the camera currently sees:
//   - camera starting / no hand       -> grey hand of the pose you should start with, pulsing
//   - the hand you showed is correct  -> orange, bigger
//   - camera cannot be used           -> grey hand with a red slash
// Sender (grab):    open hand -> fist.      Receiver (release): fist -> open hand.
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import type { HandStatus } from '../hooks/useHandGesture';

type Label = 'open' | 'fist' | 'other' | 'none';

type Props = {
  kind: 'grab' | 'release';
  status: HandStatus;
  label: Label;
  size?: number;
};

const ORANGE = '#FF6B4A';
const GREY = '#B5B5B5';
const BADGE_BG = '#FFFFFF';

function OpenHand({ color }: { color: string }) {
  return (
    <>
      <Rect x={15} y={30} width={36} height={26} rx={12} fill={color} />
      <Rect x={17} y={10} width={7.5} height={30} rx={3.75} fill={color} />
      <Rect x={26} y={6} width={7.5} height={34} rx={3.75} fill={color} />
      <Rect x={35} y={9} width={7.5} height={31} rx={3.75} fill={color} />
      <Rect x={44} y={16} width={7.5} height={24} rx={3.75} fill={color} />
      <Rect x={4} y={32} width={8} height={22} rx={4} fill={color} transform="rotate(-38 8 43)" />
    </>
  );
}

function Fist({ color }: { color: string }) {
  return (
    <>
      <Rect x={12} y={18} width={40} height={36} rx={12} fill={color} />
      {/* finger gaps */}
      <Line x1={22} y1={20} x2={22} y2={36} stroke={BADGE_BG} strokeWidth={2} strokeLinecap="round" />
      <Line x1={32} y1={19} x2={32} y2={36} stroke={BADGE_BG} strokeWidth={2} strokeLinecap="round" />
      <Line x1={42} y1={20} x2={42} y2={36} stroke={BADGE_BG} strokeWidth={2} strokeLinecap="round" />
      {/* thumb across the fingers */}
      <Rect x={14} y={34} width={26} height={10} rx={5} fill={color} stroke={BADGE_BG} strokeWidth={2} />
    </>
  );
}

function HandHint({ kind, status, label, size = 88 }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  const startPose: Label = kind === 'grab' ? 'open' : 'fist';
  const endPose: Label = kind === 'grab' ? 'fist' : 'open';
  const broken = status === 'denied' || status === 'unavailable';

  // the pose that is drawn: what the camera sees if it is one of the two poses, else the start pose
  const shown: Label = label === startPose || label === endPose ? label : startPose;
  const matched = !broken && (label === startPose || label === endPose);

  // gentle pulse while we are waiting for a hand
  useEffect(() => {
    if (matched || broken) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [matched, broken, pulse]);

  // little "pop" each time the recognised pose changes
  useEffect(() => {
    if (!matched) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, [shown, matched, pop]);

  const scale = matched
    ? pop.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.12] })
    : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] });
  const opacity = status === 'starting' ? 0.5 : 1;
  const color = broken ? GREY : matched ? ORANGE : GREY;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: matched ? ORANGE : '#E3E3E3',
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <Svg width={size * 0.66} height={size * 0.66} viewBox="0 0 64 64">
          {shown === 'fist' ? <Fist color={color} /> : <OpenHand color={color} />}
          {broken && <Path d="M10 54 L54 10" stroke="#E5484D" strokeWidth={5} strokeLinecap="round" />}
        </Svg>
      </Animated.View>
    </View>
  );
}

export default memo(HandHint);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  badge: {
    backgroundColor: BADGE_BG,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
});