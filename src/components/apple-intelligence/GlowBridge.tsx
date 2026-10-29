// src/components/apple-intelligence/GlowBridge.tsx
// Connects the app's transfer state (GlowState) to the Apple Intelligence glow:
//   transfer starts (grab) -> glow blooms in from the bottom and keeps flowing
//   transfer ends / fails / cancelled / link lost -> glow fades out
// Render it inside <SiriProvider live>.
import { useEffect } from 'react';
import { useSiri } from './context';
import { useGlowActive } from '../../services/session/GlowState';
import type { ISiriToggleOptions } from './types';

// Look of the glow - the same options as reacticx's config. Change colours here.
// Apple Intelligence palette: soft violet, lilac, periwinkle blue, coral and peach. Light and clean,
// no dark tones. They drift slowly around the screen edge.
export const GLOW_CONFIG: ISiriToggleOptions = {
  glow: {
    colors: ['#BC82F3', '#F5B9EA', '#8D9FFF', '#AA6EEE', '#FF6778', '#FFBA71', '#C686FF'],
    speed: 0.12, // slow, calm drift
  },
  border: { radius: 44, spread: 18, margin: 2 }, // radius: match your phone's screen corners
  wave: { strength: 0.8, origin: [0.5, 1] },
  shimmer: { amount: 0.25, speed: 2.2 }, // gentle shimmer
};

export default function GlowBridge() {
  const { show, hide } = useSiri();
  const active = useGlowActive();

  useEffect(() => {
    console.log(`[Glow] ${active ? 'show' : 'hide'}`);
    if (active) show(GLOW_CONFIG);
    else hide();
  }, [active, show, hide]);

  return null;
}