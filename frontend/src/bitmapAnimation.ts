import { CLIP_DURATION_MS, type BehaviorClip } from './engine';
import type { Animal, Dance } from './petRenderer';
import { HARD_WHIP_CONTACTS, isWhipClip, whipStrike, WHIP_CONTACT_PROGRESS } from './whipAnimation';

const TAU = Math.PI * 2;
const GROOVE_FRAMES = 24;
const WINK_FRAMES = 12;

export type BitmapAtlas = 'actions' | 'sway' | 'step' | 'wave' | 'wink';
export interface BitmapFrame {
  atlas: BitmapAtlas;
  frame: number;
}

export interface BitmapFrameOptions {
  animal?: Animal;
  clip: BehaviorClip;
  dance: Dance;
  phase: number;
  clipProgress?: number;
  clipElapsedMs?: number;
  reducedMotion?: boolean;
  settleFrom?: BitmapFrame;
}

const ACTION_SEQUENCES: Readonly<Record<BehaviorClip, readonly number[]>> = {
  idle: [0, 0, 0, 1, 0, 0, 0, 15],
  anticipation: [0, 2, 15],
  groove: [0],
  settle: [0],
  recover: [0, 1, 15],
  sleep: [14],
  pet: [0, 1, 9, 1, 15],
  greet: [0, 13, 7, 13, 15],
  whip: [0],
  'whip-hard': [0],
};

const QUIET_SEQUENCES: Readonly<Record<BehaviorClip, readonly number[]>> = {
  idle: [0, 0, 0, 1, 0, 0, 0, 15],
  anticipation: [0],
  groove: [0, 0, 0, 1, 0, 0, 0, 15],
  settle: [0],
  recover: [0],
  sleep: [14],
  pet: [1],
  greet: [0],
  whip: [0],
  'whip-hard': [0],
};

function progressFor(options: BitmapFrameOptions): number {
  const looping = options.clip === 'idle' || options.clip === 'groove' || options.clip === 'sleep';
  const raw = Number.isFinite(options.clipProgress) ? options.clipProgress!
    : Number.isFinite(options.clipElapsedMs) ? options.clipElapsedMs! / CLIP_DURATION_MS[options.clip]
      : Number.isFinite(options.phase) ? options.phase / TAU : 0;
  return looping ? ((raw % 1) + 1) % 1 : Math.max(0, Math.min(1, raw));
}

function sequenceFrame(sequence: readonly number[], progress: number): number {
  return sequence[Math.min(sequence.length - 1, Math.floor(progress * sequence.length))];
}

function settleFrame(from: BitmapFrame, progress: number): BitmapFrame {
  const start = ((from.frame % GROOVE_FRAMES) + GROOVE_FRAMES) % GROOVE_FRAMES;
  const target = [0, 12, 24].reduce((nearest, candidate) =>
    Math.abs(candidate - start) < Math.abs(nearest - start) ? candidate : nearest, 0);
  const distance = Math.abs(target - start);
  const steps = Math.min(distance, Math.floor(progress * (distance + 1)));
  const frame = (start + Math.sign(target - start) * steps) % GROOVE_FRAMES;
  return { atlas: from.atlas, frame };
}

/** Select one registered bitmap cell; no full-character frame blending occurs. */
export function selectBitmapFrame(options: BitmapFrameOptions): BitmapFrame {
  const progress = progressFor(options);
  if (options.clip === 'whip-hard') {
    const contact = whipStrike(progress, true).contact;
    const after = progress - contact;
    const frame = progress < HARD_WHIP_CONTACTS[0] || progress >= 0.93 ? 0
      : after >= 0 && after < 0.04 ? 2
        : progress < 0.82 ? options.animal === 'orangeFox' ? 4 : 7 : 1;
    return { atlas: 'actions', frame: options.reducedMotion ? progress >= HARD_WHIP_CONTACTS[0] && progress < 0.93 ? 1 : 0 : frame };
  }
  if (isWhipClip(options.clip)) {
    const frame = progress < WHIP_CONTACT_PROGRESS || progress >= 0.84 ? 0
      : progress < 0.51 ? 2
        : progress < 0.67 ? options.animal === 'orangeFox' ? 4 : 7 : 1;
    return { atlas: 'actions', frame: options.reducedMotion ? progress >= WHIP_CONTACT_PROGRESS && progress < 0.84 ? 1 : 0 : frame };
  }
  if (options.animal === 'orangeFox' && options.clip === 'pet') {
    return {
      atlas: 'wink',
      frame: options.reducedMotion ? 6 : Math.min(WINK_FRAMES - 1, Math.floor(progress * WINK_FRAMES)),
    };
  }
  if (options.reducedMotion) {
    return { atlas: 'actions', frame: sequenceFrame(QUIET_SEQUENCES[options.clip], progress) };
  }
  if (options.clip === 'groove') {
    return {
      atlas: options.dance,
      frame: Math.min(GROOVE_FRAMES - 1, Math.floor(progress * GROOVE_FRAMES)),
    };
  }
  if (options.clip === 'settle' && options.settleFrom && options.settleFrom.atlas !== 'actions') {
    return settleFrame(options.settleFrom, progress);
  }
  return { atlas: 'actions', frame: sequenceFrame(ACTION_SEQUENCES[options.clip], progress) };
}
