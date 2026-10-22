// src/services/gesture/HandGestureDetector.ts
// Pure logic (no React Native imports) so it can be unit-tested.
//
// Input: one frame per camera result from the native HandModule:
//   present  - is a hand visible
//   ratios   - [index, middle, ring, pinky] = |fingertip - wrist| / |knuckle - wrist|
//              (about 1.8-2.0 for a straight finger, 0.8-1.2 for a curled one)
//
//   GRAB    (sender)   : open palm  ->  closed fist
//   RELEASE (receiver) : closed fist -> open palm
//
// A gesture counts when the FIRST pose was held for `holdMs`, and the SECOND pose appears
// within `maxGapMs` and stays for `confirmMs`. Poses are accepted after `smoothFrames`
// consecutive matching frames, so slow phones (few fps) work too.

export type HandLabel = 'open' | 'fist' | 'other' | 'none';
export type HandGestureKind = 'grab' | 'release';

export type HandFrame = {
  t: number; // ms
  present: boolean;
  ratios: number[];
  fps?: number; // diagnostics from the native side
  ms?: number;
  lite?: boolean;
};

export type HandConfig = {
  extended: number;   // finger counts as straight above this ratio
  curled: number;     // finger counts as curled below this ratio
  smoothMs: number;   // a new pose must persist at least this long ...
  smoothFrames: number; // ... and for at least this many consecutive frames before it is accepted
  holdMs: number;     // first pose must be held this long
  confirmMs: number;  // second pose must be held this long
  maxGapMs: number;   // max time between leaving the first pose and the second pose being confirmed
  cooldownMs: number;
};

export const DEFAULT_HAND_CONFIG: HandConfig = {
  extended: 1.5,
  curled: 1.3,
  smoothMs: 40,
  smoothFrames: 2,
  holdMs: 200,
  confirmMs: 80,
  maxGapMs: 1500,
  cooldownMs: 2500,
};

export function classifyHand(f: HandFrame, c: HandConfig = DEFAULT_HAND_CONFIG): HandLabel {
  if (!f.present || f.ratios.length < 4) return 'none';
  const ext = f.ratios.filter((r) => r > c.extended).length;
  const curl = f.ratios.filter((r) => r < c.curled).length;
  if (ext >= 3 && curl <= 1) return 'open';
  if (curl >= 3 && ext === 0) return 'fist';
  return 'other';
}

export class HandGestureDetector {
  private cfg: HandConfig;
  private from: HandLabel;
  private to: HandLabel;
  private onGesture: () => void;
  private onLabel?: (l: HandLabel) => void;

  private label: HandLabel = 'none';      // accepted (smoothed) pose
  private labelSince = 0;
  private pending: HandLabel = 'none';    // candidate pose waiting to be accepted
  private pendingSince = 0;
  private pendingCount = 0;
  private armedAt = -Infinity;            // last time the first pose had been held long enough
  private cooldownUntil = 0;
  private started = false;

  constructor(
    kind: HandGestureKind,
    onGesture: () => void,
    onLabel?: (l: HandLabel) => void,
    overrides: Partial<HandConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_HAND_CONFIG, ...overrides };
    this.from = kind === 'grab' ? 'open' : 'fist';
    this.to = kind === 'grab' ? 'fist' : 'open';
    this.onGesture = onGesture;
    this.onLabel = onLabel;
  }

  getLabel(): HandLabel {
    return this.label;
  }

  push(frame: HandFrame) {
    const c = this.cfg;
    const t = frame.t;
    const raw = classifyHand(frame, c);

    if (!this.started) {
      this.started = true;
      this.label = raw;
      this.labelSince = t;
      this.pending = raw;
      this.pendingSince = t;
      this.pendingCount = 1;
      this.onLabel?.(raw);
    }

    // smoothing: accept a new pose only after it has persisted for smoothMs
    if (raw !== this.pending) {
      this.pending = raw;
      this.pendingSince = t;
      this.pendingCount = 1;
    } else {
      this.pendingCount++;
    }
    if (
      this.pending !== this.label &&
      this.pendingCount >= c.smoothFrames &&
      t - this.pendingSince >= c.smoothMs
    ) {
      this.label = this.pending;
      this.labelSince = this.pendingSince;
      this.onLabel?.(this.label);
    }

    if (t < this.cooldownUntil) return;

    // first pose held long enough -> armed
    if (this.label === this.from && t - this.labelSince >= c.holdMs) {
      this.armedAt = t;
    }

    // second pose confirmed shortly after -> gesture
    if (
      this.label === this.to &&
      t - this.labelSince >= c.confirmMs &&
      t - this.armedAt <= c.maxGapMs
    ) {
      this.armedAt = -Infinity;
      this.cooldownUntil = t + c.cooldownMs;
      this.onGesture();
    }
  }
}