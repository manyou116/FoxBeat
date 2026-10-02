/** FoxBeat character renderer; reference skins use bundled transparent artwork. */
import shyFoxActionsUrl from '../assets/shy-fox-actions-clean-v1.png';
import shyFoxSwayUrl from '../assets/shy-fox-sway-v1.png';
import shyFoxStepUrl from '../assets/shy-fox-step-v1.png';
import shyFoxWaveUrl from '../assets/shy-fox-wave-v1.png';
import yuexinCatActionsUrl from '../assets/yuexin-cat-actions-clean-v1.png';
import yuexinCatSwayUrl from '../assets/yuexin-cat-sway-v1.png';
import yuexinCatStepUrl from '../assets/yuexin-cat-step-v1.png';
import yuexinCatWaveUrl from '../assets/yuexin-cat-wave-v1.png';
import orangeFoxActionsUrl from '../assets/orange-fox-actions-clean-v3.png';
import orangeFoxSwayUrl from '../assets/orange-fox-sway-v3.png';
import orangeFoxStepUrl from '../assets/orange-fox-step-v3.png';
import orangeFoxWaveUrl from '../assets/orange-fox-wave-v3.png';
import orangeFoxWinkUrl from '../assets/orange-fox-wink-v1.png';
import dancingFoxIdleUrl from '../assets/dancing-fox/idle.png';
import dancingFoxFrame001Url from '../assets/dancing-fox/frame_001.png';
import dancingFoxFrame002Url from '../assets/dancing-fox/frame_002.png';
import dancingFoxFrame003Url from '../assets/dancing-fox/frame_003.png';
import dancingFoxFrame004Url from '../assets/dancing-fox/frame_004.png';
import dancingFoxFrame005Url from '../assets/dancing-fox/frame_005.png';
import dancingFoxFrame006Url from '../assets/dancing-fox/frame_006.png';
import dancingFoxFrame007Url from '../assets/dancing-fox/frame_007.png';
import dancingFoxFrame008Url from '../assets/dancing-fox/frame_008.png';
import dancingFoxFrame009Url from '../assets/dancing-fox/frame_009.png';
import dancingFoxFrame010Url from '../assets/dancing-fox/frame_010.png';
import dancingFoxFrame011Url from '../assets/dancing-fox/frame_011.png';
import dancingFoxFrame012Url from '../assets/dancing-fox/frame_012.png';
import dancingFoxFrame013Url from '../assets/dancing-fox/frame_013.png';
import dancingFoxFrame014Url from '../assets/dancing-fox/frame_014.png';
import dancingFoxFrame015Url from '../assets/dancing-fox/frame_015.png';
import dancingFoxFrame016Url from '../assets/dancing-fox/frame_016.png';
import dancingFoxFrame017Url from '../assets/dancing-fox/frame_017.png';
import dancingFoxFrame018Url from '../assets/dancing-fox/frame_018.png';
import type { BehaviorClip } from './engine';
import { selectBitmapFrame, type BitmapAtlas, type BitmapFrame } from './bitmapAnimation';
import { isWhipClip, smoothStep, whipRecoil, whipStrike } from './whipAnimation';

export type Animal = 'fox' | 'emojiFox' | 'girl' | 'cat' | 'capybara' | 'shyFox' | 'yuexinCat' | 'orangeFox' | 'dancingFox';
export type Dance = 'sway' | 'step' | 'wave' | 'sanwei';

export interface RenderOptions {
  animal: Animal;
  dance: Dance;
  /** Radians; one choreography cycle is 2π. */
  phase: number;
  energy: number;
  state: 'idle' | 'dancing' | 'settling' | 'sleeping';
  /** Semantic clip from the behavior controller; older callers may omit it. */
  clip?: BehaviorClip;
  /** Position in the current behavior, supplied by the controller. */
  clipProgress?: number;
  clipElapsedMs?: number;
  /** Exact source frame used by the original discrete animation, -1 is idle. */
  frameIndex?: number;
  reducedMotion?: boolean;
  /** A transient affection value from 0 to 1, controlled by the caller. */
  petting?: number;
}

interface Pose {
  x: number;
  y: number;
  body: number;
  head: number;
  headY: number;
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
  leftLift: number;
  rightLift: number;
  tail: number;
  leftEar: number;
  rightEar: number;
  eyes: number;
  breath: number;
  affection: number;
  sleeping: boolean;
  happy: boolean;
}

interface Palette {
  fur: string;
  light: string;
  shade: string;
  ink: string;
  pink: string;
  paw: string;
}

const COLORS: Record<Animal, Palette> = {
  fox: {
    fur: '#F3A35C', light: '#FFF3DC', shade: '#DC8144',
    ink: '#624333', pink: '#EAAD9D', paw: '#79523D',
  },
  cat: {
    fur: '#AAB8CA', light: '#F2F1EC', shade: '#8797B1',
    ink: '#4E5A70', pink: '#DEADB7', paw: '#EFF0EE',
  },
  capybara: {
    fur: '#C5A17E', light: '#E4C5A3', shade: '#AD8967',
    ink: '#644D3F', pink: '#DCAA99', paw: '#A38265',
  },
  emojiFox: {
    fur: '#F6A34F', light: '#FFF1D2', shade: '#D97438',
    ink: '#5A3B32', pink: '#F0A7A2', paw: '#86513B',
  },
  girl: {
    fur: '#473653', light: '#FFF2F5', shade: '#8D5B82',
    ink: '#34283D', pink: '#E9A1B5', paw: '#C983A6',
  },
  shyFox: {
    fur: '#F59A58', light: '#FFF9F1', shade: '#DC6F45',
    ink: '#402923', pink: '#F1A29A', paw: '#E9C9B6',
  },
  yuexinCat: {
    fur: '#D4B28B', light: '#FFFDF8', shade: '#B48A68',
    ink: '#5A302B', pink: '#E3A4A1', paw: '#FFFDF8',
  },
  orangeFox: {
    fur: '#F58B3B', light: '#FFF9F0', shade: '#D4662F',
    ink: '#43271F', pink: '#F28B83', paw: '#FFF9F0',
  },
  dancingFox: {
    fur: '#F58B3B', light: '#FFF9F0', shade: '#D4662F',
    ink: '#43271F', pink: '#F28B83', paw: '#FFF9F0',
  },
};

const TAU = Math.PI * 2;

type BitmapAnimal = 'shyFox' | 'yuexinCat' | 'orangeFox';
type BitmapSheets = Record<Exclude<BitmapAtlas, 'wink'>, string> & { wink?: string };
const BITMAP_SHEETS: Record<BitmapAnimal, BitmapSheets> = {
  shyFox: { actions: shyFoxActionsUrl, sway: shyFoxSwayUrl, step: shyFoxStepUrl, wave: shyFoxWaveUrl },
  yuexinCat: { actions: yuexinCatActionsUrl, sway: yuexinCatSwayUrl, step: yuexinCatStepUrl, wave: yuexinCatWaveUrl },
  orangeFox: { actions: orangeFoxActionsUrl, sway: orangeFoxSwayUrl, step: orangeFoxStepUrl, wave: orangeFoxWaveUrl, wink: orangeFoxWinkUrl },
};
const bitmapImages: Partial<Record<BitmapAnimal, Partial<Record<BitmapAtlas, HTMLImageElement>>>> = {};
interface BitmapPlayback {
  clip?: BehaviorClip;
  lastGroove?: BitmapFrame;
  settleFrom?: BitmapFrame;
}
const bitmapPlayback = new WeakMap<CanvasRenderingContext2D, Partial<Record<BitmapAnimal, BitmapPlayback>>>();

const DANCING_FOX_FRAMES = [
  dancingFoxFrame001Url, dancingFoxFrame002Url, dancingFoxFrame003Url,
  dancingFoxFrame004Url, dancingFoxFrame005Url, dancingFoxFrame006Url,
  dancingFoxFrame007Url, dancingFoxFrame008Url, dancingFoxFrame009Url,
  dancingFoxFrame010Url, dancingFoxFrame011Url, dancingFoxFrame012Url,
  dancingFoxFrame013Url, dancingFoxFrame014Url, dancingFoxFrame015Url,
  dancingFoxFrame016Url, dancingFoxFrame017Url, dancingFoxFrame018Url,
] as const;
const dancingFoxImages: Array<HTMLImageElement | undefined> = [];
let dancingFoxIdleImage: HTMLImageElement | undefined;
let dancingFoxPreloaded = false;

function getDancingFoxImage(frameIndex: number): HTMLImageElement | undefined {
  const url = frameIndex < 0 ? dancingFoxIdleUrl : DANCING_FOX_FRAMES[frameIndex % DANCING_FOX_FRAMES.length];
  if (!url || typeof Image === 'undefined') return undefined;
  const slot = frameIndex < 0 ? undefined : (frameIndex % DANCING_FOX_FRAMES.length);
  const cached = slot === undefined ? dancingFoxIdleImage : dancingFoxImages[slot];
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : undefined;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  if (slot === undefined) dancingFoxIdleImage = image;
  else dancingFoxImages[slot] = image;
  return undefined;
}

function getBitmapImage(animal: BitmapAnimal, atlas: BitmapAtlas): HTMLImageElement | undefined {
  const url = BITMAP_SHEETS[animal][atlas];
  if (!url) return undefined;
  const images = bitmapImages[animal] ?? (bitmapImages[animal] = {});
  const cached = images[atlas];
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : undefined;
  if (typeof Image === 'undefined') return undefined;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  images[atlas] = image;
  return undefined;
}

const bounded = (value: number, min = 0, max = 1): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

function getPose(options: RenderOptions): Pose {
  const t = Number.isFinite(options.phase) ? options.phase : 0;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const twice = Math.sin(t * 2);
  const personality = options.animal === 'capybara' ? 0.67 : options.animal === 'cat' ? 0.84 : options.animal === 'yuexinCat' ? 0.76 : options.animal === 'orangeFox' ? 0.88 : options.animal === 'girl' ? 1.08 : options.animal === 'emojiFox' ? 1.12 : options.animal === 'shyFox' ? 0.94 : 1;
  const motion = options.reducedMotion ? 0.2 : 1;
  const strength = bounded(options.energy) * personality * motion;
  const affection = bounded(options.petting ?? 0);
  // A brief blink once per cycle; outside that interval the eyes stay open.
  const cycle = ((t % TAU) + TAU) % TAU;
  const blink = Math.abs(cycle - 5.75) < 0.13 ? 0.13 : 1;
  const pose: Pose = {
    x: 0, y: 0, body: 0, head: 0, headY: 0,
    leftArm: 16, rightArm: -16, leftLeg: 4, rightLeg: -4,
    leftLift: 0, rightLift: 0, tail: 0, leftEar: 0, rightEar: 0,
    eyes: blink, breath: 1, affection,
    sleeping: options.state === 'sleeping',
    happy: affection > 0.1,
  };

  if (pose.sleeping) {
    pose.y = 12;
    pose.headY = 12;
    pose.head = -9;
    pose.leftArm = 29;
    pose.rightArm = -29;
    pose.tail = -9;
    pose.eyes = 0;
    pose.breath = 1 + Math.sin(t) * 0.008 * motion;
    pose.leftEar = -7;
    pose.rightEar = 5;
  } else if (options.state === 'idle') {
    pose.y = Math.sin(t) * 0.9 * motion;
    pose.head = Math.sin(t * 0.5) * 2.2 * motion;
    pose.tail = s * 5 * motion;
    pose.leftEar = Math.max(0, Math.sin(t * 2 - 0.6)) ** 8 * 7 * motion;
    pose.rightEar = -(Math.max(0, Math.sin(t * 2 + 1.1)) ** 8) * 5 * motion;
    pose.breath = 1 + s * 0.005 * motion;
  } else {
    // Settling runs this same choreography with a caller-supplied fading energy.
    pose.tail = Math.sin(t - 0.7) * 12 * strength;
    pose.leftEar = Math.sin(t + 0.7) * 5 * strength;
    pose.rightEar = Math.sin(t - 0.7) * -5 * strength;
    pose.happy = strength > 0.55 && options.dance === 'wave';
    if (options.animal === 'emojiFox' || options.animal === 'shyFox') pose.breath = 1 + twice * 0.035 * strength;
    pose.headY = -Math.max(0, Math.sin(t * 2)) * 2 * strength;
    if (options.dance === 'sway') {
      pose.x = s * 7 * strength;
      pose.y = -Math.abs(s) * 2 * strength;
      pose.body = s * 9 * strength;
      pose.head = -s * 12 * strength;
      pose.leftArm = 16 + (33 + s * 25) * strength;
      pose.rightArm = -16 + (-33 + s * 25) * strength;
      pose.leftLeg = 4 - s * 12 * strength;
      pose.rightLeg = -4 - s * 12 * strength;
      pose.leftLift = Math.max(0, s) * 4 * strength;
      pose.rightLift = Math.max(0, -s) * 4 * strength;
    } else if (options.dance === 'step') {
      pose.x = s * 3 * strength;
      pose.y = -Math.abs(c) * 7 * strength;
      pose.body = s * 5 * strength;
      pose.head = -s * 6 * strength;
      pose.leftArm = 16 + (23 + s * 39) * strength;
      pose.rightArm = -16 + (-23 + s * 39) * strength;
      pose.leftLeg = 4 + s * 23 * strength;
      pose.rightLeg = -4 - s * 23 * strength;
      pose.leftLift = Math.max(0, s) * 17 * strength;
      pose.rightLift = Math.max(0, -s) * 17 * strength;
      pose.tail = Math.sin(t + 0.6) * 17 * strength;
    } else {
      pose.y = -Math.max(0, twice) * 8 * strength;
      pose.body = s * 4 * strength;
      pose.head = -s * 8 * strength;
      pose.leftArm = 16 + (101 + Math.sin(t + 0.5) * 25) * strength;
      pose.rightArm = -16 + (-101 + Math.sin(t - 0.5) * 25) * strength;
      pose.leftLeg = 4 + c * 9 * strength;
      pose.rightLeg = -4 - c * 9 * strength;
      pose.leftLift = Math.max(0, twice) * 3 * strength;
      pose.rightLift = Math.max(0, twice) * 3 * strength;
      pose.leftEar += Math.sin(t * 2) * 4 * strength;
      pose.rightEar -= Math.sin(t * 2) * 4 * strength;
    }
  }
  if (affection > 0) {
    pose.head += -8 * affection;
    pose.headY -= 2 * affection;
    pose.eyes = Math.min(pose.eyes, 1 - affection * 0.9);
    pose.tail += Math.sin(t * 3) * 8 * affection * motion;
    if (options.animal === 'girl') {
      pose.leftArm += 36 * affection * motion;
      pose.rightArm -= 36 * affection * motion;
    } else if (options.animal === 'emojiFox' || options.animal === 'shyFox') {
      pose.leftEar -= 12 * affection * motion;
      pose.rightEar += 12 * affection * motion;
      pose.y -= Math.sin(affection * Math.PI) * 6 * motion;
    }
  }
  return pose;
}

const softPulse = (progress: number, start: number, end: number): number => {
  if (progress <= start || progress >= end) return 0;
  return Math.sin(Math.PI * (progress - start) / (end - start)) ** 2;
};

/** Choreography for the five drawn companions; bitmap skins retain their own frame timing. */
export function getVectorPose(options: RenderOptions): Pose {
  const clip = options.clip ?? (options.state === 'sleeping' ? 'sleep'
    : options.state === 'idle' ? 'idle' : options.state === 'settling' ? 'settle' : 'groove');
  const t = Number.isFinite(options.phase) ? options.phase : 0;
  const progress = bounded(options.clipProgress ?? ((t % TAU + TAU) % TAU) / TAU);
  const motion = options.reducedMotion ? 0.2 : 1;
  const energy = bounded(options.energy) * motion;
  const beat = Math.sin(t);
  const follow = Math.sin(t - 0.65);
  const pose = getPose(isWhipClip(clip) ? { ...options, state: 'idle', phase: 0, petting: 0 }
    : clip === 'pet' || clip === 'greet' ? { ...options, state: 'idle' } : options);

  if (clip === 'idle') {
    switch (options.animal) {
      case 'fox':
        pose.leftEar -= softPulse(progress, 0.14, 0.28) * 9 * motion;
        pose.tail += softPulse(progress, 0.62, 0.86) * 7 * motion;
        break;
      case 'cat':
        pose.rightEar += softPulse(progress, 0.21, 0.34) * 8 * motion;
        pose.tail -= softPulse(progress, 0.54, 0.87) * 9 * motion;
        pose.leftArm += softPulse(progress, 0.43, 0.67) * 7 * motion;
        break;
      case 'capybara':
        pose.head += softPulse(progress, 0.26, 0.7) * 4 * motion;
        pose.leftEar += softPulse(progress, 0.79, 0.9) * 4 * motion;
        break;
      case 'emojiFox':
        pose.leftEar -= softPulse(progress, 0.1, 0.23) * 11 * motion;
        pose.rightEar += softPulse(progress, 0.12, 0.25) * 9 * motion;
        pose.rightArm -= softPulse(progress, 0.56, 0.72) * 9 * motion;
        pose.tail += softPulse(progress, 0.68, 0.88) * 8 * motion;
        break;
      case 'girl':
        pose.head += softPulse(progress, 0.28, 0.57) * 4 * motion;
        pose.tail -= softPulse(progress, 0.5, 0.82) * 6 * motion;
        pose.rightArm -= softPulse(progress, 0.6, 0.78) * 5 * motion;
        pose.leftEar = pose.tail * 0.5;
        break;
    }
    return pose;
  }

  if (clip === 'sleep') {
    pose.headY += Math.sin(progress * TAU) * 0.8 * motion;
    pose.breath += Math.sin(progress * TAU) * 0.003 * motion;
    return pose;
  }

  if (clip === 'anticipation') {
    const lead = progress * progress * (3 - 2 * progress);
    pose.x *= lead;
    pose.y = pose.y * lead + softPulse(progress, 0, 1) * 3 * motion;
    pose.body *= lead;
    pose.head *= lead;
    pose.headY *= lead;
    pose.tail *= lead;
    pose.leftEar *= lead;
    pose.rightEar *= lead;
    pose.leftArm = 16 + (pose.leftArm - 16) * lead;
    pose.rightArm = -16 + (pose.rightArm + 16) * lead;
    pose.leftLeg = 4 + (pose.leftLeg - 4) * lead;
    pose.rightLeg = -4 + (pose.rightLeg + 4) * lead;
    pose.leftLift *= lead;
    pose.rightLift *= lead;
    pose.breath = 1 + (pose.breath - 1) * lead;
    return pose;
  }

  if (isWhipClip(clip)) {
    const hard = clip === 'whip-hard';
    const recoil = whipRecoil(progress, hard) * motion;
    pose.x -= (hard ? 24 : 11) * recoil;
    pose.y -= (hard ? 22 : 7) * recoil;
    pose.body -= (hard ? 11 : 5) * recoil;
    pose.head -= (hard ? 20 : 12) * recoil;
    pose.tail -= (hard ? 30 : 18) * recoil;
    pose.leftEar -= (hard ? 18 : 8) * recoil;
    pose.rightEar += (hard ? 20 : 10) * recoil;
    pose.eyes = Math.min(pose.eyes, 1 - 0.8 * recoil);
    pose.leftArm += (hard ? 35 : 18) * recoil;
    pose.rightArm -= (hard ? 42 : 22) * recoil;
    if (hard) {
      pose.leftLift += 7 * recoil;
      pose.rightLift += 4 * recoil;
      pose.breath -= 0.06 * recoil;
    }
    return pose;
  }

  if (clip === 'pet' || clip === 'greet') {
    const gesture = progress === 0 || progress === 1 ? 0 : Math.sin(Math.PI * progress) ** 2 * motion;
    const hand = Math.sin(progress * TAU * 2) * gesture;
    if (clip === 'pet') {
      pose.head -= 8 * gesture;
      pose.headY += 3 * gesture;
      pose.y += 2 * gesture;
      pose.eyes = Math.min(pose.eyes, 1 - 0.88 * gesture);
      pose.happy = gesture > 0.25;
      if (options.animal === 'girl') {
        pose.leftArm += 34 * gesture;
        pose.rightArm -= 27 * gesture;
        pose.tail -= 7 * gesture;
      } else if (options.animal === 'capybara') {
        pose.leftEar -= 5 * gesture;
        pose.rightEar += 5 * gesture;
        pose.leftArm += 11 * gesture;
      } else {
        pose.leftEar -= 11 * gesture;
        pose.rightEar += 11 * gesture;
        pose.tail += 8 * gesture;
        pose.leftArm += 14 * gesture;
        pose.rightArm -= 14 * gesture;
      }
    } else {
      pose.head -= 5 * gesture;
      pose.y -= 3 * gesture;
      pose.happy = gesture > 0.3;
      if (options.animal === 'capybara') {
        pose.rightArm -= (38 + 5 * hand) * gesture;
        pose.head += 4 * gesture;
      } else if (options.animal === 'girl') {
        pose.rightArm -= 73 * gesture + 8 * hand;
        pose.tail += 8 * gesture;
      } else {
        pose.rightArm -= 68 * gesture + 10 * hand;
        pose.tail -= 10 * gesture;
        pose.rightEar -= 5 * gesture;
      }
    }
    return pose;
  }

  const easeOut = clip === 'settle' || clip === 'recover' ? 1 - progress : 1;
  const accent = energy * easeOut;
  switch (options.animal) {
    case 'fox':
      pose.head -= follow * 3 * accent;
      pose.tail += follow * 6 * accent;
      pose.leftEar += Math.sin(t + 0.4) * 4 * accent;
      pose.rightEar -= Math.sin(t - 0.4) * 4 * accent;
      if (options.dance === 'wave') {
        pose.leftArm = 16 + (32 + 8 * beat) * accent;
        pose.rightArm = -16 - (90 + 12 * follow) * accent;
      }
      break;
    case 'cat':
      pose.body *= 0.78;
      pose.head += follow * 2.5 * accent;
      pose.tail += Math.sin(t - 0.95) * 9 * accent;
      pose.rightEar -= Math.sin(t + 0.8) * 3 * accent;
      if (options.dance === 'step') pose.leftArm += Math.max(0, beat) * 8 * accent;
      if (options.dance === 'wave') {
        pose.leftArm = 16 + 18 * accent;
        pose.rightArm = -16 - (70 + 8 * follow) * accent;
      }
      break;
    case 'capybara':
      pose.x *= 0.72;
      pose.y *= 0.7;
      pose.body *= 0.55;
      pose.head += follow * 2 * accent;
      pose.tail *= 0.25;
      pose.leftLift *= 0.6;
      pose.rightLift *= 0.6;
      pose.leftEar += beat * 2 * accent;
      if (options.dance === 'wave') {
        pose.leftArm = 16 + 14 * accent;
        pose.rightArm = -16 - (44 + 5 * follow) * accent;
      }
      break;
    case 'emojiFox':
      pose.head -= follow * 4 * accent;
      pose.tail += Math.sin(t - 0.9) * 9 * accent;
      pose.leftEar -= Math.max(0, beat) * 8 * accent;
      pose.rightEar += Math.max(0, -beat) * 8 * accent;
      pose.breath *= 1 + Math.abs(beat) * 0.009 * accent;
      if (options.dance === 'wave') {
        pose.leftArm = 16 + (88 + 11 * beat) * accent;
        pose.rightArm = -16 - (38 + 8 * follow) * accent;
      }
      break;
    case 'girl':
      pose.head -= follow * 3 * accent;
      pose.tail += Math.sin(t - 0.95) * 5 * accent;
      pose.leftEar = pose.tail * 0.4;
      pose.rightEar = follow * 3 * accent;
      pose.leftArm += beat * 5 * accent;
      pose.rightArm -= follow * 5 * accent;
      if (options.dance === 'wave') {
        pose.leftArm = 16 + (26 + 5 * beat) * accent;
        pose.rightArm = -16 - (83 + 10 * follow) * accent;
      }
      break;
  }
  return pose;
}

function rotate(ctx: CanvasRenderingContext2D, degrees: number): void {
  ctx.rotate(degrees * Math.PI / 180);
}

function ellipse(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
  fill: string, stroke?: string, angle = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawPath(ctx: CanvasRenderingContext2D, data: string, fill: string, stroke?: string): void {
  const path = new Path2D(data);
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(path); }
}

function line(ctx: CanvasRenderingContext2D, data: string, color: string, width = 2.5): void {
  const oldWidth = ctx.lineWidth;
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke(new Path2D(data));
  ctx.lineWidth = oldWidth;
}

function drawTail(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  ctx.save();
  ctx.translate(31, 4);
  rotate(ctx, pose.tail);
  if (animal === 'fox' || animal === 'shyFox') {
    const outline = 'M-5 14 C21 30 58 28 77 1 C97-27 82-59 89-83 C52-67 51-44 36-35 C24-26 7-24-5-10 Z';
    drawPath(ctx, outline, p.fur, p.ink);
    ctx.save();
    ctx.clip(new Path2D(outline));
    drawPath(ctx, 'M34-82 L105-102 L109-16 L72-16 L61-28 L55-23 L54-40 L44-37 L47-52 L33-55 Z', p.light);
    ctx.restore();
    line(ctx, 'M10 12 C38 20 58 12 66-4', p.shade, 3);
    ctx.strokeStyle = p.ink;
    ctx.stroke(new Path2D(outline));
  } else if (animal === 'cat' || animal === 'yuexinCat') {
    const outline = 'M-2 12 C24 28 55 21 58-7 C60-22 52-30 42-27 C31-24 35-9 39-5 C34 6 15 5 5-4 Z';
    drawPath(ctx, outline, p.fur, p.ink);
    ctx.save();
    ctx.clip(new Path2D(outline));
    line(ctx, 'M33-24 L57-20 M37-7 L61-2 M24 10 L29 26', p.shade, 7);
    ctx.restore();
  } else {
    // Capybaras do not have a visible tail. A little haunch peeks behind the body.
    ellipse(ctx, 5, 22, 14, 19, p.shade, p.ink);
  }
  ctx.restore();
}

function drawLeg(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number,
  lift: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * 23, 31 - lift);
  rotate(ctx, angle);
  drawPath(ctx, 'M-12-4 C-14 6-12 15-12 24 C-6 33 10 33 14 24 L13 2 Z', p.fur, p.ink);
  ellipse(ctx, side * 2, 24, 18, 10, p.paw, p.ink);
  const toes = animal === 'fox' || animal === 'shyFox' ? '#AC8060' : p.shade;
  line(ctx, 'M-5 25 L-5 29 M2 26 L2 30', toes, 1.5);
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, animal: Animal, p: Palette): void {
  if (animal === 'capybara') {
    drawPath(ctx, 'M-32-34 C-53-14-50 29-32 43 C-16 55 23 53 38 35 C51 17 46-20 28-35 Z', p.fur, p.ink);
    ellipse(ctx, 0, 13, 27, 31, p.light);
    line(ctx, 'M-7 30 Q0 34 7 30', p.shade, 2);
  } else {
    drawPath(ctx, 'M-27-37 C-41-29-46-4-43 21 C-42 44-24 50 0 49 C29 50 45 40 44 16 C44-10 37-32 24-38 Z', p.fur, p.ink);
    if (animal === 'fox' || animal === 'shyFox') {
      drawPath(ctx, 'M-26-30 C-35-14-27-1-27 10 L-17 6 L-14 19 L-5 14 L0 25 L8 14 L16 19 L19 6 L28 9 C30-8 29-24 23-31 Z', p.light);
      ellipse(ctx, 0, 28, 18, 14, p.light);
    } else if (animal === 'yuexinCat') {
      ellipse(ctx, 0, 12, 28, 34, p.light);
      drawPath(ctx, 'M-22-28 Q-8-18 0-23 Q8-18 22-28 L17-12 Q0-3-17-12 Z', '#C79E78');
    } else {
      ellipse(ctx, 0, 10, 28, 34, p.light);
      line(ctx, 'M-41-5 L-30 0 M-43 8 L-31 12 M40-5 L30 0 M43 8 L32 12', p.shade, 4);
    }
  }
}

function drawArm(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * 34, -16);
  rotate(ctx, angle);
  drawPath(ctx, 'M-10-2 C-15 6-15 21-12 32 C-9 43 10 43 13 32 C16 19 14 8 10-2 Z', p.fur, p.ink);
  ellipse(ctx, 0, 33, 13, 12, p.paw, p.ink);
  const toes = animal === 'fox' || animal === 'shyFox' ? '#B48B6B' : p.shade;
  line(ctx, 'M-4 35 L-4 39 M3 35 L3 39', toes, 1.5);
  ctx.restore();
}

function drawEar(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * (animal === 'capybara' ? 43 : 38), animal === 'capybara' ? -31 : -33);
  rotate(ctx, angle);
  if (animal === 'fox' || animal === 'shyFox') {
    ctx.scale(side, 1);
    drawPath(ctx, 'M-21 12 C-24-8-9-39 7-52 C16-39 25-10 20 12 Z', p.fur, p.ink);
    drawPath(ctx, 'M-10 4 C-9-10-1-28 7-36 C13-25 17-9 12 4 Z', p.pink);
    drawPath(ctx, 'M0-40 L7-52 C12-45 16-37 17-30 L9-31 Z', p.paw);
  } else if (animal === 'cat' || animal === 'yuexinCat') {
    ctx.scale(side, 1);
    drawPath(ctx, 'M-20 12 C-24-5-17-30-5-39 C11-34 23-11 23 11 Z', p.fur, p.ink);
    drawPath(ctx, 'M-11 5 C-14-6-10-20-5-25 C5-20 13-8 14 4 Z', animal === 'yuexinCat' ? '#B88772' : p.pink);
  } else {
    ellipse(ctx, 0, -2, 15, 18, p.fur, p.ink, side * 0.2);
    ellipse(ctx, 0, -3, 7, 10, p.shade, undefined, side * 0.2);
  }
  ctx.restore();
}

function drawEyes(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  const spread = animal === 'capybara' ? 32 : 25;
  const y = animal === 'capybara' ? -2 : 2;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * spread, y);
    if (pose.eyes < 0.3) {
      const curve = pose.happy ? 'M-7 3 Q0-5 7 3' : 'M-7 0 Q0 6 7 0';
      line(ctx, curve, p.ink, 3);
    } else if (animal === 'yuexinCat') {
      ellipse(ctx, 0, 0, 4.1, 8 * pose.eyes, '#3766B4');
      ellipse(ctx, -1, -3.4, 1.2, 2.1, '#F7FBFF');
    } else if (animal === 'capybara') {
      ellipse(ctx, 0, 1, 4.5, 5.1 * pose.eyes, p.ink);
      ellipse(ctx, -1.2, -0.8, 1.1, 1.3, '#FFFFFF');
      line(ctx, 'M-6-6 Q0-8 5-6', p.shade, 2);
    } else {
      ellipse(ctx, 0, 0, 5.8, 8 * pose.eyes, p.ink);
      ellipse(ctx, -1.8, -3.1, 1.8, 2.2, '#FFFDF5');
      ellipse(ctx, 2, 3.8, 0.9, 1.1, '#FFFDF5');
    }
    ctx.restore();
  }
}

function drawFace(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  if (animal === 'fox') {
    const face = 'M-59-22 C-63-43-34-54 0-50 C32-54 61-39 59-20 L68 0 L59 3 L65 13 L52 13 C40 35 13 49 0 47 C-22 48-42 33-53 18 L-66 17 L-59 7 L-69 5 Z';
    drawPath(ctx, face, p.fur, p.ink);
    // Two cream cheek patches converge in a fox's narrow muzzle.
    drawPath(ctx, 'M-57-8 C-37-12-25-2-12 12 Q0 24 12 12 C27-3 39-12 58-8 C62 5 47 29 30 35 Q0 57-29 36 C-45 28-61 8-57-8 Z', p.light);
    drawPath(ctx, 'M-17-46 Q-10-39-7-29 Q-2-36 0-42 Q3-32 8-28 Q11-40 18-45', p.shade);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    drawPath(ctx, 'M-6 18 Q0 15 6 18 Q6 22 0 25 Q-6 22-6 18', p.ink);
    line(ctx, 'M0 25 L0 29 M-9 28 Q-5 35 0 29 Q5 35 9 28', p.ink, 2.3);
  } else if (animal === 'shyFox') {
    const face = 'M-59-22 C-63-43-34-54 0-50 C32-54 61-39 59-20 L68 0 L59 3 L65 13 L52 13 C40 35 13 49 0 47 C-22 48-42 33-53 18 L-66 17 L-59 7 L-69 5 Z';
    drawPath(ctx, face, p.fur, p.ink);
    drawPath(ctx, 'M-57-8 C-37-12-25-2-12 12 Q0 24 12 12 C27-3 39-12 58-8 C62 5 47 29 30 35 Q0 57-29 36 C-45 28-61 8-57-8 Z', p.light);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    line(ctx, 'M-50-11 Q-38-22-24-15', p.ink, 4);
    line(ctx, 'M24-15 Q38-22 50-11', p.ink, 4);
    drawPath(ctx, 'M-6 18 Q0 15 6 18 Q6 22 0 25 Q-6 22-6 18', p.ink);
    line(ctx, 'M0 25 L0 29 M-8 31 Q0 26 8 31', p.ink, 2.3);
  } else if (animal === 'cat') {
    drawPath(ctx, 'M-57-27 C-43-46-21-49 0-47 C29-49 53-36 59-17 C66 7 58 33 38 41 C16 52-19 50-39 41 C-61 32-66 1-57-27 Z', p.fur, p.ink);
    drawPath(ctx, 'M-39 16 C-25 3-13 7 0 14 C15 6 31 5 42 20 C36 39 14 45 0 44 C-16 45-33 34-39 16 Z', p.light);
    line(ctx, 'M-15-43 L-12-29 M0-46 L0-28 M15-42 L12-29', p.shade, 5);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    drawPath(ctx, 'M-6 18 Q0 14 6 18 Q3 24 0 24 Q-3 24-6 18', '#BA8B91');
    line(ctx, 'M0 24 L0 29 M-10 27 Q-6 35 0 29 Q6 35 10 27', p.ink, 2.2);
    line(ctx, 'M-43 23 L-66 19 M-42 29 L-64 31 M43 23 L66 19 M42 29 L64 31', p.ink, 1.6);
  } else if (animal === 'yuexinCat') {
    drawPath(ctx, 'M-57-27 C-43-46-21-49 0-47 C29-49 53-36 59-17 C66 7 58 33 38 41 C16 52-19 50-39 41 C-61 32-66 1-57-27 Z', p.fur, p.ink);
    drawPath(ctx, 'M-39 12 C-25 2-12 5 0 14 C15 6 31 5 42 18 C36 39 14 45 0 44 C-16 45-33 34-39 12 Z', p.light);
    line(ctx, 'M-15-43 L-12-29 M0-46 L0-28 M15-42 L12-29', p.shade, 5);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    drawPath(ctx, 'M-6 18 Q0 14 6 18 Q3 24 0 24 Q-3 24-6 18', '#BA8B91');
    line(ctx, 'M0 24 L0 29 M-10 27 Q-6 35 0 29 Q6 35 10 27', p.ink, 2.2);
    line(ctx, 'M-43 23 L-66 19 M-42 29 L-64 31 M43 23 L66 19 M42 29 L64 31', p.ink, 1.6);
    // A raised white paw gives the companion the hand-over-face pose from the reference.
    drawPath(ctx, 'M-51 1 Q-39-8-28 1 L-11 19 Q-4 29-13 37 Q-23 43-30 31 L-50 17 Z', p.paw, p.ink);
    line(ctx, 'M-31 8 L-20 19 M-37 13 L-27 25', p.shade, 2);
  } else {
    drawPath(ctx, 'M-60-23 C-48-41-21-42 0-40 C24-41 50-37 59-18 C68-6 71 16 61 31 C51 46 29 49 0 48 C-28 49-53 44-62 30 C-73 14-69-10-60-23 Z', p.fur, p.ink);
    // Capybara's broad, blunt muzzle and separated nostrils give it its silhouette.
    drawPath(ctx, 'M-43 10 C-32-3 31-4 45 11 C53 20 45 39 29 42 C9 47-18 45-34 39 C-47 34-52 19-43 10 Z', p.light);
    ellipse(ctx, -48, 15, 9, 5, p.pink);
    ellipse(ctx, 48, 15, 9, 5, p.pink);
    drawEyes(ctx, animal, pose, p);
    ellipse(ctx, -11, 17, 3.4, 2.8, p.ink, undefined, -0.4);
    ellipse(ctx, 11, 17, 3.4, 2.8, p.ink, undefined, 0.4);
    line(ctx, 'M0 23 L0 28 M-9 28 Q0 33 9 28', p.ink, 2.4);
    line(ctx, 'M-15-32 Q-8-36-3-32 M4-32 Q10-35 15-31', p.shade, 2);
  }
}

function bitmapClip(options: RenderOptions): BehaviorClip {
  if (options.clip) return options.clip;
  if (options.state === 'sleeping') return 'sleep';
  if (options.state === 'idle') return 'idle';
  if (options.state === 'settling') return 'settle';
  return 'groove';
}

function drawBitmapCompanion(
  ctx: CanvasRenderingContext2D, animal: BitmapAnimal, pose: Pose, p: Palette, options: RenderOptions,
): void {
  if (animal === 'orangeFox') getBitmapImage(animal, 'wink');
  const clip = bitmapClip(options);
  const instances = bitmapPlayback.get(ctx) ?? {};
  const playback = instances[animal] ?? {};
  if (clip === 'settle' && playback.clip !== 'settle') {
    playback.settleFrom = playback.clip === 'groove' ? playback.lastGroove : undefined;
  } else if (clip !== 'settle') {
    playback.settleFrom = undefined;
  }
  const selected = selectBitmapFrame({
    animal,
    clip,
    dance: options.dance,
    phase: options.phase,
    clipProgress: options.clipProgress,
    clipElapsedMs: options.clipElapsedMs,
    reducedMotion: options.reducedMotion,
    settleFrom: playback.settleFrom,
  });
  playback.clip = clip;
  instances[animal] = playback;
  bitmapPlayback.set(ctx, instances);

  // The cleaned neutral cell is a stable fallback while the dance atlas decodes.
  let atlas = selected.atlas;
  let image = getBitmapImage(animal, atlas);
  let frame = selected.frame;
  if (!image && atlas !== 'actions') {
    atlas = 'actions';
    frame = 0;
    image = getBitmapImage(animal, atlas);
  }
  if (!image) {
    if (animal === 'yuexinCat') drawReferenceCat(ctx, pose, p);
    else drawReferenceFox(ctx, pose, p, animal === 'shyFox');
    return;
  }
  if (clip === 'groove' && atlas !== 'actions') {
    playback.lastGroove = selected;
  }

  const columns = atlas === 'actions' ? 4 : 6;
  const width = 280;
  ctx.drawImage(image, (frame % columns) * 320, Math.floor(frame / columns) * 320, 320, 320,
    -width / 2 + 1, -194, width, width);
}

function drawDancingFox(ctx: CanvasRenderingContext2D, options: RenderOptions, pose: Pose, p: Palette): void {
  if (!dancingFoxPreloaded && typeof Image !== 'undefined') {
    getDancingFoxImage(-1);
    DANCING_FOX_FRAMES.forEach((_, index) => getDancingFoxImage(index));
    dancingFoxPreloaded = true;
  }
  const index = options.frameIndex ?? -1;
  const image = getDancingFoxImage(index) ?? getDancingFoxImage(-1);
  if (!image) return;
  // Source drawings are 720x784. Keep their aspect ratio and put the paws on
  // the same ground line as the other FoxBeat companions.
  const width = 282;
  const height = width * 784 / 720;
  ctx.drawImage(image, -width / 2, -height + 20, width, height);
}

function drawToyWhip(
  ctx: CanvasRenderingContext2D, progress: number, reducedMotion: boolean,
  contact: { x: number; y: number }, hard = false,
): void {
  const p = bounded(progress);
  const { snap, rebound, reach: strikeReach, impact } = whipStrike(p, hard);
  const enter = smoothStep(p / 0.2);
  const retreat = smoothStep((p - (hard ? 0.83 : 0.72)) / (hard ? 0.17 : 0.28));
  const gripX = reducedMotion ? 282 : 315 - 33 * enter + 33 * retreat - (hard ? 5 * strikeReach : 0);
  const gripY = (hard ? 207 : 225) + (hard ? 20 : 7) * snap - (hard ? 20 : 7) * rebound;
  const reach = reducedMotion ? strikeReach >= 0.5 ? 1 : 0 : strikeReach;
  const tipX = (gripX - (hard ? 8 : 19)) * (1 - reach) + contact.x * reach;
  const tipY = (gripY - (reducedMotion ? 25 : hard ? 83 : 48)) * (1 - reach) + contact.y * reach;
  const bendAmount = hard ? strikeReach : snap;
  const bendX = gripX - (hard ? 62 : 40) - (hard ? 22 : 14) * bendAmount;
  const bendY = gripY - (hard ? 58 : 28) * (1 - bendAmount) + (hard ? 37 : 25) * bendAmount;
  ctx.save();
  ctx.globalAlpha = Math.min(1, p * 9, (1 - p) * 8);
  if (hard && !reducedMotion && reach > 0.15 && rebound < 0.7) {
    ctx.save();
    ctx.globalAlpha *= Math.sin(reach * Math.PI) * 0.55;
    ctx.strokeStyle = '#C99161';
    ctx.lineWidth = 2;
    for (const offset of [8, 18]) {
      ctx.beginPath();
      ctx.moveTo(gripX - 12 + offset, gripY - 69);
      ctx.quadraticCurveTo(gripX - 67 + offset, gripY - 24, contact.x + offset, contact.y - 12);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = '#4B3028';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(gripX, gripY);
  ctx.bezierCurveTo(gripX - 9, gripY - 19, bendX, bendY, tipX, tipY);
  ctx.stroke();
  ctx.strokeStyle = '#B7784E';
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(gripX, gripY);
  ctx.bezierCurveTo(gripX - 9, gripY - 19, bendX, bendY, tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = '#D68D5B';
  ctx.strokeStyle = '#4B3028';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(tipX, tipY, 3, 5, -0.7, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gripX + 4, gripY + 7);
  ctx.lineTo(gripX - 5, gripY - 13);
  ctx.stroke();
  ctx.fillStyle = '#FFF7ED';
  ctx.beginPath();
  ctx.ellipse(gripX + 9, gripY + 8, 14, 11, -0.45, 0, TAU);
  ctx.fill();
  ctx.stroke();
  if (!reducedMotion && impact > 0) {
    ctx.globalAlpha *= impact;
    ctx.strokeStyle = '#F2B84B';
    ctx.lineWidth = hard ? 3.5 : 2.5;
    if (hard) {
      ctx.save();
      ctx.translate(contact.x, contact.y);
      ctx.scale(0.65 + impact * 0.45, 0.65 + impact * 0.45);
      drawPath(ctx, 'M0-13 L4-5 L13-7 L8 1 L14 7 L5 8 L1 16 L-4 8 L-12 10 L-8 2 L-14-4 L-5-5 Z', '#FFD76C', '#C77A37');
      ctx.restore();
    }
    for (const angle of [-0.9, 0.15, 1.15]) {
      const x = contact.x + Math.cos(angle) * (hard ? 18 : 8);
      const y = contact.y + Math.sin(angle) * (hard ? 18 : 8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * (hard ? 13 : 9), y + Math.sin(angle) * (hard ? 13 : 9));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  ctx.save();
  ctx.translate(0, (animal === 'capybara' ? -70 : -77) + pose.headY);
  rotate(ctx, pose.head);
  drawEar(ctx, animal, -1, pose.leftEar, p);
  drawEar(ctx, animal, 1, pose.rightEar, p);
  drawFace(ctx, animal, pose, p);
  ctx.restore();
}

/** Flat, thick-outlined fox silhouette matching the supplied reference stickers. */
function drawReferenceFox(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette, handOverMouth: boolean): void {
  ctx.save();
  ctx.translate(pose.x * 0.45, pose.y * 0.35);
  rotate(ctx, pose.head * 0.22);
  const oldWidth = ctx.lineWidth;
  ctx.lineWidth = 6;
  drawPath(ctx, 'M-117 70 Q-75 28-31 46 Q0 63 31 46 Q75 28 117 70 L119 119 L-119 119 Z', p.fur, p.ink);
  drawPath(ctx, 'M-112-31 L-112-143 Q-105-165-91-153 L-26-76 Z', p.fur, p.ink);
  drawPath(ctx, 'M112-31 L112-143 Q105-165 91-153 L26-76 Z', p.fur, p.ink);
  drawPath(ctx, 'M-98-53 L-99-119 Q-97-134-88-125 L-48-78 Z', p.light, p.ink);
  drawPath(ctx, 'M98-53 L99-119 Q97-134 88-125 L48-78 Z', p.light, p.ink);
  drawPath(ctx, 'M-111-49 Q-91-105-29-111 Q0-119 29-111 Q91-105 111-49 L116 18 Q106 67 50 76 Q0 91-50 76 Q-106 67-116 18 Z', p.fur, p.ink);
  drawPath(ctx, 'M-110 22 Q-74 1-42 22 Q-17 41 0 40 Q17 41 42 22 Q74 1 110 22 Q91 73 47 84 Q0 99-47 84 Q-91 73-110 22 Z', p.light, p.ink);
  ellipse(ctx, -50, 19, 21, 12, p.pink);
  ellipse(ctx, 50, 19, 21, 12, p.pink);
  ellipse(ctx, -43, 0, 12, 14, p.ink);
  ellipse(ctx, 43, 0, 12, 14, p.ink);
  line(ctx, 'M-65-20 Q-47-39-27-25', p.ink, 8);
  line(ctx, 'M27-25 Q47-39 65-20', p.ink, 8);
  drawPath(ctx, 'M-12 36 Q0 29 12 36 Q9 47 0 49 Q-9 47-12 36 Z', p.ink);
  line(ctx, 'M0 49 L0 57 M-14 55 Q0 65 14 55', p.ink, 5);
  if (handOverMouth) {
    drawPath(ctx, 'M-31 119 Q-42 93-30 71 Q-19 51-4 58 Q7 63 5 79 Q17 63 28 70 Q37 77 30 91 L13 119 Z', p.light, p.ink);
    line(ctx, 'M-2 78 Q-8 91-10 105', p.ink, 4);
  } else {
    drawPath(ctx, 'M-100 119 Q-107 93-93 73 Q-82 60-69 75 L-60 119 Z', p.light, p.ink);
    drawPath(ctx, 'M100 119 Q107 93 93 73 Q82 60 69 75 L60 119 Z', p.light, p.ink);
  }
  ctx.lineWidth = oldWidth;
  ctx.restore();
}

/** Flat beige cat with blue vertical eyes and a raised paw, matching the supplied Yuexin reference. */
function drawReferenceCat(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette): void {
  ctx.save();
  ctx.translate(pose.x * 0.35, pose.y * 0.25);
  rotate(ctx, pose.head * 0.18);
  const oldWidth = ctx.lineWidth;
  ctx.lineWidth = 6;
  drawPath(ctx, 'M-55 18 Q-75 56-66 103 Q0 119 66 103 Q75 56 55 18 Z', p.fur, p.ink);
  drawPath(ctx, 'M-38 20 Q-13 38 0 35 Q13 38 38 20 L45 105 Q0 119-45 105 Z', p.light, p.ink);
  drawPath(ctx, 'M63 70 Q107 91 119 66 Q127 49 114 43 Q105 39 101 53 Q96 67 79 54', p.fur, p.ink);
  drawPath(ctx, 'M-105-20 L-93-139 Q-89-157-73-143 L-20-75 Z', p.fur, p.ink);
  drawPath(ctx, 'M105-20 L93-139 Q89-157 73-143 L20-75 Z', p.fur, p.ink);
  drawPath(ctx, 'M-88-48 L-82-116 Q-80-128-73-119 L-45-79 Z', '#FFFDFC', p.ink);
  drawPath(ctx, 'M88-48 L82-116 Q80-128 73-119 L45-79 Z', '#FFFDFC', p.ink);
  drawPath(ctx, 'M-105-31 Q-81-97-27-106 Q0-112 27-106 Q81-97 105-31 L110 35 Q100 84 43 91 Q0 101-43 91 Q-100 84-110 35 Z', p.fur, p.ink);
  drawPath(ctx, 'M-70 17 Q-45-5-23 14 Q-8 26 0 26 Q8 26 23 14 Q45-5 70 17 Q52 72 0 78 Q-52 72-70 17 Z', p.light, p.ink);
  ellipse(ctx, -38, -6, 8, 24 * pose.eyes, '#2E63C1');
  ellipse(ctx, 38, -6, 8, 24 * pose.eyes, '#2E63C1');
  ellipse(ctx, -40, -14, 2.5, 5, '#F8FBFF');
  ellipse(ctx, 36, -14, 2.5, 5, '#F8FBFF');
  drawPath(ctx, 'M-10 35 Q0 28 10 35 Q7 45 0 46 Q-7 45-10 35 Z', p.ink);
  line(ctx, 'M0 46 L0 54 M-11 52 Q0 61 11 52', p.ink, 4);
  // Raised paw crosses the left eye and keeps the reference's shy gesture.
  drawPath(ctx, 'M-88 54 Q-73 24-50 31 Q-34 38-42 56 L-56 81 Q-64 96-78 88 Q-92 78-88 54 Z', p.light, p.ink);
  line(ctx, 'M-67 44 Q-55 58-57 73 M-76 50 Q-66 62-69 77', p.ink, 4);
  ctx.lineWidth = oldWidth;
  ctx.restore();
}

/** An original chibi companion inspired by the reference's braid and violet palette. */
function drawGirl(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette): void {
  const skin = '#FFE5D9';
  ctx.save();
  rotate(ctx, pose.tail * 0.22);
  drawPath(ctx, 'M-54-118 C-70-161-29-179 4-174 C62-178 78-133 65-93 L70 24 Q43 38 21 17 L-39 27 Q-73 35-67 3 Z', p.fur, p.ink);
  line(ctx, 'M-48-97 Q-62-36-49 13 M51-102 Q65-42 54 16', '#65506F', 4);
  ctx.restore();
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 16, 32 - (side < 0 ? pose.leftLift : pose.rightLift) * 0.6);
    rotate(ctx, (side < 0 ? pose.leftLeg : pose.rightLeg) * 0.7);
    drawPath(ctx, 'M-7 0 L8 0 L7 28 Q0 33-7 28 Z', skin, p.ink);
    drawPath(ctx, 'M-7 18 L7 18 L7 33 L-7 33 Z', '#FFF4F3', p.ink);
    ellipse(ctx, side * 3, 34, 12, 7, '#674566', p.ink);
    ellipse(ctx, side * 4, 32, 5, 2, '#CEA0BC');
    ctx.restore();
  }
  drawPath(ctx, 'M-19-52 Q0-43 19-52 L29-16 L23 12 L-24 12 L-29-16 Z', '#FFF6EF', p.ink);
  ctx.save(); rotate(ctx, pose.tail * 0.18);
  drawPath(ctx, 'M-23-12 Q0-5 23-12 L42 39 Q0 57-42 39 Z', '#C17FAD', p.ink);
  line(ctx, 'M-18-3 L-27 38 M0 0 L0 45 M18-3 L27 38', '#9B6494', 2);
  drawPath(ctx, 'M-43 38 Q0 53 43 38 L41 44 Q0 59-41 44 Z', '#FFF1F1', p.ink);
  ctx.restore();
  drawPath(ctx, 'M-18-46 L0-30 L18-46 L11-50 L0-41 L-11-50 Z', '#E7B8CE', p.ink);
  drawPath(ctx, 'M0-32 L-13-39 L-12-25 Z M0-32 L13-39 L12-25 Z', '#A15D96', p.ink);
  ellipse(ctx, 0, -32, 3, 4, '#F2BDD7');
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 26, -37);
    rotate(ctx, (side < 0 ? pose.leftArm : pose.rightArm) * 0.85);
    drawPath(ctx, 'M-9-3 Q-15 6-9 18 L9 18 Q15 6 9-3 Z', '#FFF6EF', p.ink);
    drawPath(ctx, 'M-7 16 L7 16 L7 34 Q0 41-7 34 Z', skin, p.ink);
    ellipse(ctx, 0, 35, 8, 8, skin, p.ink);
    line(ctx, 'M-2 34 L-2 38 M2 34 L2 38', '#D79C96', 1);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(0, -94 + pose.headY);
  rotate(ctx, pose.head);
  drawPath(ctx, 'M-56-7 C-70-64-23-76 9-70 C56-70 72-39 61 8 L52 38 L-54 36 Z', p.fur, p.ink);
  ellipse(ctx, -48, 9, 8, 13, skin, p.ink);
  ellipse(ctx, 48, 9, 8, 13, skin, p.ink);
  drawPath(ctx, 'M-48-29 Q0-55 48-29 L47 11 Q42 44 0 53 Q-42 44-47 11 Z', skin, p.ink);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 23, 9);
    if (pose.eyes < 0.3) {
      line(ctx, pose.happy ? 'M-11 2 Q0-9 11 2' : 'M-11 0 Q0 7 11 0', p.ink, 3);
    } else {
      ellipse(ctx, 0, 0, 11.5, 14 * pose.eyes, '#FFFFFF', p.ink);
      ellipse(ctx, 1, 1, 8.5, 12 * pose.eyes, '#875DA4');
      ellipse(ctx, 1, 4, 6, 7 * pose.eyes, '#C489BC');
      ellipse(ctx, 1, 1, 3.8, 8 * pose.eyes, '#422A56');
      ellipse(ctx, -3, -6, 3.8, 4.2, '#FFFFFF');
      ellipse(ctx, 5, 5, 1.9, 2.1, '#FFF3FC');
      line(ctx, 'M-12-7 Q0-16 11-8', p.ink, 3.5);
      line(ctx, side < 0 ? 'M-11-7 L-16-11' : 'M11-7 L16-11', p.ink, 2);
    }
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha *= 0.45 + pose.affection * 0.5;
  ellipse(ctx, -34, 28, 10, 4.5, p.pink);
  ellipse(ctx, 34, 28, 10, 4.5, p.pink); ctx.restore();
  if (pose.happy) drawPath(ctx, 'M-7 32 Q0 36 7 32 Q5 44 0 44 Q-5 44-7 32', '#C56B8B', p.ink);
  else line(ctx, 'M-5 35 Q0 39 5 35', '#AB6D7E', 2);
  // Uneven bangs, side locks and a loose braid move as independent pieces.
  ctx.save(); ctx.translate(pose.leftEar * 0.12, pose.rightEar * 0.1);
  drawPath(ctx, 'M-52-34 Q-39-65 5-61 Q42-64 55-28 L50 8 L36-4 L30-34 L24-6 L11-18 L4-39 L-3-13 L-17-21 L-27-42 L-30-9 L-44 1 Z', p.fur, p.ink);
  ctx.restore();
  drawPath(ctx, 'M-53-20 Q-62 22-44 45 Q-54 19-43-7 Z M53-21 Q65 24 46 44 Q55 16 44-8 Z', p.fur, p.ink);
  line(ctx, 'M-37-45 Q-34-52-29-55 M-22-58 L-15-61 M4-60 L10-56 M30-53 L35-47', '#8D779D', 4);
  ctx.save(); ctx.translate(52, -8); rotate(ctx, pose.tail * 0.55);
  for (let i = 0; i < 6; i++) {
    ellipse(ctx, i % 2 ? 3 : -1, i * 12, 8, 10, i % 2 ? '#594163' : '#6D5078', p.ink, i % 2 ? -0.5 : 0.5);
  }
  drawPath(ctx, 'M0 66 L-13 60 L-11 76 Z M0 66 L13 60 L11 76 Z', '#DDA5CC', p.ink);
  ellipse(ctx, 0, 67, 3.5, 4, '#F6D4E9'); ctx.restore();
  drawPath(ctx, 'M-43-30 L-51-40 L-40-37 L-36-47 L-32-36 L-20-36 L-30-29 L-27-19 L-37-25 L-46-19 Z', '#ECC9A0', '#B99576');
  ctx.restore();
}

/** Bold emoji-like silhouette with oversized ears and a tiny elastic body. */
function drawEmojiFox(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette): void {
  ctx.save(); ctx.translate(-7, 1); ctx.scale(0.8, 0.8);
  drawTail(ctx, 'fox', { ...pose, tail: pose.tail * 1.35 }, p); ctx.restore();
  ellipse(ctx, 0, 20, 33, 34, p.fur, p.ink);
  ellipse(ctx, 0, 25, 22, 24, p.light);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 18, 51 - (side < 0 ? pose.leftLift : pose.rightLift) * 0.45);
    rotate(ctx, (side < 0 ? pose.leftLeg : pose.rightLeg) * 0.8);
    ellipse(ctx, 0, 0, 15, 8, p.paw, p.ink); ctx.restore();
    ctx.save(); ctx.translate(side * 29, 3);
    rotate(ctx, (side < 0 ? pose.leftArm : pose.rightArm));
    ellipse(ctx, 0, 16, 10, 20, p.fur, p.ink);
    ellipse(ctx, 0, 31, 10, 9, p.paw, p.ink); ctx.restore();
  }
  ctx.save(); ctx.translate(0, -69 + pose.headY); rotate(ctx, pose.head);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 39, -32); ctx.scale(side, 1);
    rotate(ctx, side < 0 ? pose.leftEar : pose.rightEar);
    drawPath(ctx, 'M-19 18 L-11-49 Q-9-58-2-48 L30 7 Z', p.fur, p.ink);
    drawPath(ctx, 'M-10 7 L-7-35 L15 3 Z', '#6D4141');
    drawPath(ctx, 'M-7 0 L-5-24 L9 0 Z', p.pink); ctx.restore();
  }
  drawPath(ctx, 'M-63-35 Q0-56 63-35 L71 0 L64-4 L72 13 L58 13 Q31 56 0 62 Q-31 56-58 13 L-72 13 L-64-4 L-71 0 Z', p.fur, p.ink);
  drawPath(ctx, 'M-63 3 Q-40-4-16 22 Q0 38 16 22 Q40-4 63 3 Q39 46 0 58 Q-39 46-63 3 Z', p.light);
  for (const side of [-1, 1]) {
    if (pose.eyes < 0.3) line(ctx, `M${side*27-7} 4 Q${side*27} ${pose.happy?-3:11} ${side*27+7} 4`, p.ink, 3.4);
    else {
      ellipse(ctx, side * 27, 3, 6, 8 * pose.eyes, '#342D2E');
      ellipse(ctx, side * 27 - 2, 0, 2, 2.5, '#FFFFFF');
    }
  }
  ellipse(ctx, -46, 19, 9, 4.5, p.pink); ellipse(ctx, 46, 19, 9, 4.5, p.pink);
  drawPath(ctx, 'M-9 29 Q0 25 9 29 Q7 37 0 38 Q-7 37-9 29', '#342D2E');
  if (pose.happy) drawPath(ctx, 'M-9 41 Q0 46 9 41 Q7 54 0 54 Q-7 54-9 41 Z', '#D57C89', p.ink);
  else line(ctx, 'M0 38 L0 43 M-10 41 Q-5 48 0 43 Q5 48 10 41', p.ink, 2);
  ctx.restore();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  drawPath(ctx, 'M0 0 C-14-9-12-22-4-22 Q0-22 3-17 Q6-22 10-22 C19-22 21-9 3 2 Z', '#EBA7AB');
  ctx.restore();
}

function drawAffection(ctx: CanvasRenderingContext2D, amount: number, reduced: boolean): void {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalAlpha *= amount;
  const drift = reduced ? 0 : (1 - amount) * 23;
  heart(ctx, 82, 103 - drift, 0.58);
  heart(ctx, 237, 78 - drift, 0.76);
  ellipse(ctx, 250, 112 - drift, 2.5, 2.5, '#ECC78C');
  ellipse(ctx, 68, 87 - drift, 2, 2, '#ECC78C');
  ctx.restore();
}

function drawSleepBubble(ctx: CanvasRenderingContext2D, phase: number, reduced: boolean): void {
  ctx.save();
  const float = reduced ? 0 : Math.sin(phase) * 2;
  ctx.globalAlpha *= 0.72;
  ellipse(ctx, 225, 124 + float, 4, 4, '#F8EFE4', '#B49E87');
  ellipse(ctx, 237, 112 + float, 6, 6, '#F8EFE4', '#B49E87');
  ellipse(ctx, 254, 92 + float, 15, 13, '#FFF7EA', '#B49E87');
  // A tiny sleeping crescent, drawn geometrically instead of depending on a font.
  drawPath(ctx, 'M257 83 C244 82 243 99 257 102 C248 101 249 87 257 83 Z', '#D1B581');
  ctx.restore();
}

/**
 * Draw into a transparent canvas. The caller owns clearing, DPR, and the clock.
 * Every local transform is restored, including when the destination is empty.
 */
export function renderPet(
  ctx: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions,
): void {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) return;
  const animal = Object.prototype.hasOwnProperty.call(COLORS, options.animal) ? options.animal : 'fox';
  const p = COLORS[animal];
  const pose = animal === 'shyFox' || animal === 'yuexinCat' || animal === 'orangeFox' || animal === 'dancingFox'
    ? getPose({ ...options, animal }) : getVectorPose({ ...options, animal });
  ctx.save();
  const scale = Math.min(width, height) / 320;
  ctx.translate((width - 320 * scale) / 2, (height - 320 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = animal === 'shyFox' || animal === 'yuexinCat' ? 4.5 : 2.5;

  // The only scenery is a soft, translucent grounding shadow.
  ellipse(ctx, 160, 284, 50, 7, 'rgba(104, 83, 64, 0.085)');
  ellipse(ctx, 160, 284, 36, 4, 'rgba(104, 83, 64, 0.045)');
  ctx.save();
  const isBitmap = animal === 'orangeFox' || animal === 'shyFox' || animal === 'yuexinCat';
  const isDancingFox = animal === 'dancingFox';
  const progress = Number.isFinite(options.clipProgress) ? Math.max(0, Math.min(1, options.clipProgress!))
    : ((options.phase % TAU) + TAU) % TAU / TAU;
  const activeClip = isBitmap ? bitmapClip(options) : undefined;
  const bitmapAmount = options.reducedMotion || options.state === 'sleeping' ? 0
    : activeClip === 'groove' ? 1 : activeClip === 'idle' ? 0.25
      : activeClip === 'settle' || activeClip === 'recover' ? (1 - progress) * 0.5 : 0.45;
  const bitmapSwing = isWhipClip(activeClip) ? 0 : activeClip === 'groove' || activeClip === 'idle'
    ? Math.sin(progress * TAU) : Math.sin(progress * Math.PI);
  const stepping = isBitmap && activeClip === 'groove' && options.dance === 'step';
  const hardWhip = options.clip === 'whip-hard';
  const whipReaction = isWhipClip(options.clip) && !options.reducedMotion ? whipRecoil(progress, hardWhip) : 0;
  const bitmapX = bitmapSwing * (stepping ? 2.5 : 1.8) * bitmapAmount - (hardWhip ? 24 : 11) * whipReaction;
  const bitmapY = stepping
    ? -Math.max(0, Math.sin(progress * TAU * 2)) * 4 * bitmapAmount
    : -Math.abs(bitmapSwing) * 1.2 * bitmapAmount;
  const characterX = 151 + (isBitmap ? bitmapX : isDancingFox ? 9 : pose.x);
  const characterY = 215 + (isBitmap ? bitmapY - (hardWhip ? 22 : 7) * whipReaction : isDancingFox ? 48 : pose.y);
  const characterAngle = (isBitmap ? bitmapSwing * 1.5 * bitmapAmount - (hardWhip ? 11 : 5) * whipReaction : isDancingFox ? 0 : pose.body) * Math.PI / 180;
  const characterStretch = isBitmap ? 1 + Math.sin(progress * TAU) * 0.002 * bitmapAmount - (hardWhip ? 0.09 * whipReaction : 0) : isDancingFox ? 1 : pose.breath;
  const characterWidth = isBitmap && hardWhip ? 1 + 0.045 * whipReaction : 1;
  ctx.translate(characterX, characterY);
  ctx.rotate(characterAngle);
  ctx.scale(characterWidth, characterStretch);
  if (animal === 'girl') drawGirl(ctx, pose, p);
  else if (animal === 'emojiFox') drawEmojiFox(ctx, pose, p);
  else if (isDancingFox) drawDancingFox(ctx, options, pose, p);
  else if (isBitmap) drawBitmapCompanion(ctx, animal, pose, p, options);
  else {
    drawTail(ctx, animal, pose, p);
    drawLeg(ctx, animal, -1, pose.leftLeg, pose.leftLift, p);
    drawLeg(ctx, animal, 1, pose.rightLeg, pose.rightLift, p);
    drawBody(ctx, animal, p);
    drawArm(ctx, animal, -1, pose.leftArm, p);
    drawArm(ctx, animal, 1, pose.rightArm, p);
    drawHead(ctx, animal, pose, p);
  }
  ctx.restore();

  if (isWhipClip(options.clip)) {
    // Hip anchors are in the character's local drawing coordinates, near the tail base.
    const hip = animal === 'orangeFox' ? { x: 44, y: 40 }
      : animal === 'shyFox' ? { x: 70, y: 54 }
        : animal === 'emojiFox' ? { x: 24, y: 43 } : { x: 30, y: 41 };
    const contact = {
      x: characterX + hip.x * characterWidth * Math.cos(characterAngle) - hip.y * characterStretch * Math.sin(characterAngle),
      y: characterY + hip.x * characterWidth * Math.sin(characterAngle) + hip.y * characterStretch * Math.cos(characterAngle),
    };
    drawToyWhip(ctx, progress, !!options.reducedMotion, contact, hardWhip);
  }

  if (pose.sleeping) drawSleepBubble(ctx, Number.isFinite(options.phase) ? options.phase : 0, !!options.reducedMotion);
  if (animal !== 'orangeFox' && !isDancingFox) drawAffection(ctx, pose.affection, !!options.reducedMotion);
  ctx.restore();
}
