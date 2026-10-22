// src/hooks/useHandGesture.ts
// Runs the front camera + hand recognition while `enabled`, and calls onGesture on
// open palm -> fist (kind 'grab') or fist -> open palm (kind 'release').
import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Vibration } from 'react-native';
import { HandGestureDetector, HandGestureKind, HandLabel } from '../services/gesture/HandGestureDetector';
import { HandSensor } from '../services/gesture/HandSensor';

export type HandStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable';

type Options = {
  kind: HandGestureKind;
  enabled: boolean;
  onGesture: () => void;
};

export function useHandGesture({ kind, enabled, onGesture }: Options) {
  const callback = useRef(onGesture);
  callback.current = onGesture;

  const [status, setStatus] = useState<HandStatus>('idle');
  const [label, setLabel] = useState<HandLabel>('none');
  const [errorText, setErrorText] = useState('');
  const [stats, setStats] = useState('');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !appActive) {
      setStatus('idle');
      setLabel('none');
      setStats('');
      return;
    }
    if (Platform.OS !== 'android' || !HandSensor.isSupported()) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setStatus('starting');
    setErrorText('');

    (async () => {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (cancelled) return;
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('denied');
        return;
      }

      const detector = new HandGestureDetector(
        kind,
        () => {
          Vibration.vibrate(80); // feedback: gesture recognised
          callback.current();
        },
        (l) => setLabel(l),
      );

      try {
        let lastStats = 0;
        const off = await HandSensor.subscribe((f) => {
          detector.push(f);
          if (f.fps !== undefined && f.t - lastStats > 700) {
            lastStats = f.t;
            setStats(`${Math.round(f.fps)} fps · ${Math.round(f.ms ?? 0)} ms${f.lite ? ' · lite' : ''}`);
          }
        });
        if (cancelled) {
          off();
          return;
        }
        unsubscribe = off;
        setStatus('ready');
      } catch (e: any) {
        if (cancelled) return;
        setErrorText(e?.message ?? 'Could not start the camera');
        setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [kind, enabled, appActive]);

  return { status, label, errorText, stats };
}

export const LABEL_TEXT: Record<HandLabel, string> = {
  open: '✋ open hand',
  fist: '✊ fist',
  other: '🤚 …',
  none: 'no hand seen',
};