// src/services/session/GlowState.ts
// ONE place that says "a transfer is in progress" -> GlowBridge (App.tsx) shows / hides the Apple
// Intelligence glow. Screens only call GlowState.set(); they never mount a glow themselves.
//
//   send    : sender, from the grab until every transfer is finished / cancelled
//   receive : receiver, from "GRABBED" until the transfer is done / failed / cancelled
import { useSyncExternalStore } from 'react';

type Source = 'send' | 'receive';

const flags: Record<Source, boolean> = { send: false, receive: false };
const listeners = new Set<() => void>();
let snapshot = false;

function recompute() {
  const next = flags.send || flags.receive;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export const GlowState = {
  set(source: Source, on: boolean) {
    if (flags[source] === on) return;
    flags[source] = on;
    console.log(`[Glow] ${source} -> ${on ? 'ON' : 'off'}`);
    recompute();
  },
  isActive() {
    return snapshot;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useGlowActive(): boolean {
  return useSyncExternalStore(GlowState.subscribe, GlowState.isActive, GlowState.isActive);
}