// src/services/gesture/HandSensor.ts
// Wrapper over the native HopperHand module (android/.../hand/HandModule.kt).
import { NativeEventEmitter, NativeModules, EmitterSubscription } from 'react-native';
import type { HandFrame } from './HandGestureDetector';

const Native = NativeModules.HopperHand;

type Listener = (f: HandFrame) => void;
let listeners = new Set<Listener>();
let nativeSub: EmitterSubscription | null = null;
let started: Promise<void> | null = null;

export const HandSensor = {
  isSupported(): boolean {
    return !!Native;
  },

  // Starts the front camera + hand model (first listener) and streams frames to `listener`.
  // Rejects if the camera/model cannot start (message explains why).
  async subscribe(listener: Listener): Promise<() => void> {
    if (!Native) throw new Error('Hand recognition is not available in this build');

    listeners.add(listener);
    if (!started) {
      const emitter = new NativeEventEmitter(Native);
      nativeSub = emitter.addListener('HopperHand', (e: any) => {
        const frame: HandFrame = {
          t: e.t,
          present: !!e.present,
          ratios: e.ratios ?? [],
          fps: e.fps,
          ms: e.ms,
          lite: e.lite,
        };
        listeners.forEach((l) => l(frame));
      });
      started = Native.start().then(() => undefined);
    }

    try {
      await started;
    } catch (err) {
      listeners.delete(listener);
      if (listeners.size === 0) teardown();
      throw err;
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) teardown();
    };
  },
};

function teardown() {
  nativeSub?.remove();
  nativeSub = null;
  started = null;
  try {
    Native.stop();
  } catch (e) {
    // ignore
  }
}