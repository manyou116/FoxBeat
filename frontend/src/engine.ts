import { isWhipClip } from './whipAnimation';

export type Mode = 'continuous' | 'step';
export type MotionState = 'idle' | 'dancing' | 'settling' | 'sleeping';

/** A semantic clip that the renderer or a speech layer can select. */
export type BehaviorClip =
  | 'idle'
  | 'anticipation'
  | 'groove'
  | 'settle'
  | 'recover'
  | 'sleep'
  | 'pet'
  | 'greet'
  | 'whip'
  | 'whip-hard';

export type ActivitySource = 'keyboard' | 'mouse' | 'scroll' | 'preview' | 'unknown';

export interface SpeechTrigger {
  /** Monotonic id, useful for a React effect that must show each line once. */
  id: number;
  /** Semantic reason; a character-specific phrase bank can map this to text. */
  kind: 'pulse' | 'pet' | 'click' | 'idle' | 'sleep';
  at: number;
  source?: ActivitySource;
}

export interface Motion {
  phase: number;
  energy: number;
  /** Compatibility state used by the existing renderer. */
  state: MotionState;
  /** Finer-grained behavior state for clips and interaction layers. */
  behavior: BehaviorClip;
  clip: BehaviorClip;
  /** Visible playback time in this clip; long paint gaps are capped. */
  clipElapsedMs: number;
  /** Normalized position within this clip. Loops wrap; reactions stop at 1. */
  clipProgress: number;
  /** Exact frame index for a discrete character, -1 means its idle image. */
  frameIndex?: number;
  /** Set on the first sample after a behavior event and then consumed. */
  speech?: SpeechTrigger;
}

export type BehaviorEvent =
  | { type: 'pulse'; count?: number; now: number; source?: ActivitySource }
  | { type: 'pet'; now: number }
  | { type: 'click'; now: number }
  | { type: 'whip'; now: number; strength?: 'gentle' | 'strong' }
  | { type: 'idle'; now: number };

const TAU = Math.PI * 2;
const SLEEP_AFTER = 30_000;
const GROOVE_AFTER = 2_800;
const SETTLE_END = 3_300;
const RECOVER_END = 3_800;
const ANTICIPATION_MS = 240;
const PET_MS = 1_200;
const GREET_MS = 850;
const WHIP_MS = 1_500;
const HARD_WHIP_MS = 2_300;
const SPEECH_COOLDOWN = 18_000;
// At 36 frames per groove cycle, 64ms cannot skip over a source pose on resume.
const MAX_VISUAL_DELTA_MS = 64;
// One choreography cycle now takes about 3.3–3.5 seconds at normal energy.
// The old 1.6π rate made a 16-frame sheet advance every ~70–80ms, which
// looked like a fast flicker instead of a deliberate dance. Around 200ms per
// frame gives the hand-drawn poses enough time to read.
const GROOVE_PHASE_RATE = Math.PI * 0.6;
const DANCING_FOX_FRAMES = 18;
export const CLIP_DURATION_MS: Readonly<Record<BehaviorClip, number>> = {
  idle: 3_200,
  anticipation: ANTICIPATION_MS,
  groove: GROOVE_AFTER - ANTICIPATION_MS,
  settle: SETTLE_END - GROOVE_AFTER,
  recover: RECOVER_END - SETTLE_END,
  sleep: 3_200,
  pet: PET_MS,
  greet: GREET_MS,
  whip: WHIP_MS,
  'whip-hard': HARD_WHIP_MS,
};

const bounded = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/**
 * Input-to-behavior state machine. It intentionally contains no DOM or random
 * timers, so transitions and speech triggers can be tested with a fake clock.
 * DanceEngine below is kept as the public compatibility name used by PetCanvas.
 */
export class BehaviorController {
  private phase = 0;
  private energy = 0;
  private lastPulse = Number.NEGATIVE_INFINITY;
  private lastActivity = Number.NEGATIVE_INFINITY;
  private lastTime: number | undefined;
  private created: number | undefined;
  private behavior: BehaviorClip = 'idle';
  private behaviorAt: number | undefined;
  private clipPlayheadMs = 0;
  private grooveOffsetMs = 0;
  private grooveResumeMs = 0;
  private mode: Mode = 'continuous';
  private sensitivity = 1;
  private profile: 'standard' | 'dancingFox' = 'standard';
  private exactFrame = -1;
  private suspendedAt: number | undefined;
  private speechAt = Number.NEGATIVE_INFINITY;
  private speechId = 0;
  private speechQueue: SpeechTrigger[] = [];

  configure(mode: Mode, sensitivity = 1, profile: 'standard' | 'dancingFox' = 'standard') {
    if (this.mode !== mode || this.profile !== profile) this.reset();
    this.mode = mode;
    this.profile = profile;
    this.sensitivity = bounded(sensitivity, 0.5, 1.5);
  }

  reset() {
    this.phase = 0;
    this.energy = 0;
    this.lastPulse = Number.NEGATIVE_INFINITY;
    this.lastActivity = Number.NEGATIVE_INFINITY;
    this.lastTime = undefined;
    this.created = undefined;
    this.behavior = 'idle';
    this.behaviorAt = undefined;
    this.clipPlayheadMs = 0;
    this.grooveOffsetMs = 0;
    this.grooveResumeMs = 0;
    this.exactFrame = -1;
    this.suspendedAt = undefined;
    this.speechAt = Number.NEGATIVE_INFINITY;
    this.speechQueue = [];
  }

  /** Handle one semantic event. Unknown or invalid timestamps are ignored. */
  event(event: BehaviorEvent): void {
    if (!Number.isFinite(event.now)) return;
    switch (event.type) {
      case 'pulse': this.pulse(event.count ?? 1, event.now, event.source); break;
      case 'pet': this.pet(event.now); break;
      case 'click': this.click(event.now); break;
      case 'whip': this.whip(event.now, event.strength); break;
      case 'idle': this.idle(event.now); break;
    }
  }

  pulse(count: number, now: number, source: ActivitySource = 'unknown'): void {
    if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(now)) return;
    if (this.isExactStep() && this.suspendedAt !== undefined) return;
    const boundedCount = this.profile === 'dancingFox' && this.mode === 'step'
      ? Math.floor(count) : Math.min(12, Math.floor(count));
    if (boundedCount <= 0) return;
    // Input can arrive before a delayed background paint observes the timeout.
    if (this.isExactStep() && now - this.lastPulse >= 2_000) this.exactFrame = -1;
    this.created ??= now;
    this.lastPulse = now;
    this.lastActivity = now;
    this.energy = Math.min(1, Math.max(0.35, this.energy + boundedCount * 0.11 * this.sensitivity));
    if (this.profile === 'dancingFox' && this.mode === 'step') {
      this.exactFrame = (this.exactFrame + boundedCount % DANCING_FOX_FRAMES + DANCING_FOX_FRAMES) % DANCING_FOX_FRAMES;
      this.phase = (this.exactFrame / DANCING_FOX_FRAMES) * TAU;
    } else if (this.mode === 'step') this.phase = (this.phase + boundedCount * Math.PI / 12) % TAU;

    // A new input during a recovery resumes the phrase; only a fresh phrase
    // needs the short lead-in.
    if (this.profile === 'dancingFox' && this.mode === 'step') {
      // The original companion has no lead-in or recovery animation: one
      // accepted input immediately selects exactly one of its 18 drawings.
      this.transition('groove', now, true);
    } else if (this.behavior === 'idle' || this.behavior === 'sleep') {
      this.transition('anticipation', now);
    } else if (this.behavior === 'settle' || this.behavior === 'recover') {
      this.transition('groove', now);
    }
    this.maybeSpeak('pulse', now, source);
  }

  pet(now: number): void {
    if (this.isExactStep()) return;
    if (!Number.isFinite(now)) return;
    this.created ??= now;
    this.lastActivity = now;
    this.energy = Math.max(this.energy, 0.55);
    this.transition('pet', now, true);
    this.maybeSpeak('pet', now);
  }

  click(now: number): void {
    if (this.isExactStep()) return;
    if (!Number.isFinite(now)) return;
    this.created ??= now;
    this.lastActivity = now;
    this.energy = Math.max(this.energy, 0.45);
    this.transition('greet', now, true);
    this.maybeSpeak('click', now);
  }

  whip(now: number, strength: 'gentle' | 'strong' = 'gentle'): void {
    if (this.isExactStep()) return;
    if (!Number.isFinite(now)) return;
    this.created ??= now;
    this.lastActivity = now;
    this.transition(strength === 'strong' ? 'whip-hard' : 'whip', now, true);
  }

  /** Mark an explicit quiet period; the normal clock still controls sleep. */
  idle(now: number): void {
    if (!Number.isFinite(now)) return;
    this.created ??= now;
    this.lastActivity = this.lastActivity === Number.NEGATIVE_INFINITY ? now : this.lastActivity;
    if (this.behavior !== 'sleep') this.transition('idle', now);
    this.maybeSpeak('idle', now);
  }

  /** Read and remove the next speech semantic trigger, if any. */
  consumeSpeech(): SpeechTrigger | undefined { return this.speechQueue.shift(); }

  /** Inspect the current clip without advancing the clock. */
  currentClip(): BehaviorClip { return this.behavior; }

  sample(now: number, autoplay = false): Motion {
    if (!Number.isFinite(now)) now = this.lastTime ?? 0;
    if (this.isExactStep() && this.suspendedAt !== undefined) now = this.suspendedAt;
    this.created ??= now;
    this.behaviorAt ??= now;
    const visualFrom = Math.max(this.lastTime ?? this.behaviorAt, this.behaviorAt);
    const visualDeltaMs = Math.max(0, Math.min(MAX_VISUAL_DELTA_MS, now - visualFrom));
    this.clipPlayheadMs += visualDeltaMs;
    const dt = visualDeltaMs / 1000;
    this.lastTime = now;

    const reactionDuration = this.behavior === 'pet' ? PET_MS
      : this.behavior === 'greet' ? GREET_MS
        : isWhipClip(this.behavior) ? CLIP_DURATION_MS[this.behavior] : 0;
    if (!this.isExactStep() && autoplay && (!reactionDuration || now - this.behaviorAt >= reactionDuration)) {
      this.transition('groove', now);
      this.phase = (this.phase + dt * GROOVE_PHASE_RATE * 0.94) % TAU;
      const result = this.buildMotion('groove', 0.78);
      result.speech = this.speechQueue.shift();
      return result;
    }

    const activityAt = Number.isFinite(this.lastActivity) ? this.lastActivity : this.created;
    const age = Number.isFinite(activityAt) ? Math.max(0, now - activityAt) : Infinity;
    const sinceBehavior = Math.max(0, now - this.behaviorAt);

    if (this.isExactStep()) {
      if (age >= 2_000) {
        this.exactFrame = -1;
        this.energy = 0;
        this.transition('idle', now);
      } else if (this.exactFrame >= 0) {
        this.behavior = 'groove';
      }
      const exact = this.buildMotion(this.behavior, this.exactFrame >= 0 ? 1 : 0);
      exact.speech = this.speechQueue.shift();
      return exact;
    }

    if (this.behavior === 'anticipation' && sinceBehavior >= ANTICIPATION_MS) {
      this.transition('groove', this.behaviorAt + ANTICIPATION_MS);
    }
    if (this.behavior === 'pet' && sinceBehavior >= PET_MS) {
      this.transition(now - this.lastPulse < GROOVE_AFTER ? 'groove' : 'idle', now);
    }
    if (this.behavior === 'greet' && sinceBehavior >= GREET_MS) {
      this.transition(now - this.lastPulse < GROOVE_AFTER ? 'groove' : 'idle', now);
    }
    if (isWhipClip(this.behavior) && sinceBehavior >= reactionDuration) {
      this.transition(now - this.lastPulse < GROOVE_AFTER ? 'groove' : 'idle', now);
    }

    // The normal continuous mode keeps the current groove alive while input
    // arrives, then gives the current phrase a settle and recovery tail.
    if (this.mode === 'step' && !(reactionDuration && sinceBehavior < reactionDuration)) {
      // Preserve the original two-second step timeout while exposing a short
      // recovery clip immediately before it returns to the idle pose.
      if (age >= 1_800 && age < 2_000 && this.behavior !== 'recover' && this.behavior !== 'idle' && this.behavior !== 'sleep') {
        this.transition('recover', this.lastActivity + 1_800);
      }
      if (age >= 2_000 && this.behavior !== 'idle' && this.behavior !== 'sleep') {
        this.transition('idle', now);
      }
    } else {
      const phraseActive = this.behavior === 'anticipation' || this.behavior === 'groove'
        || this.behavior === 'settle' || this.behavior === 'recover';
      if (phraseActive) {
        if (age >= GROOVE_AFTER && age < SETTLE_END && this.behavior !== 'settle') {
          this.transition('settle', this.lastActivity + GROOVE_AFTER);
        } else if (age >= SETTLE_END && age < RECOVER_END && this.behavior !== 'recover') {
          this.transition('recover', this.lastActivity + SETTLE_END);
        } else if (age >= RECOVER_END) {
          this.transition('idle', now);
        }
      }
    }

    if (age > SLEEP_AFTER && this.behavior === 'idle') {
      this.transition('sleep', activityAt + SLEEP_AFTER);
      this.maybeSpeak('sleep', now);
    }

    const state = this.behavior;
    const active = state === 'anticipation' || state === 'groove' || state === 'pet' || state === 'greet' || isWhipClip(state);
    const settling = state === 'settle' || state === 'recover';
    if (active || settling) {
      const speed = state === 'anticipation' ? 0.72 : state === 'recover' ? 0.52 : 0.86 + this.energy * 0.28;
      // Step mode advances only when pulse() is called; time may animate a
      // recovery clip but must not drift the selected step between inputs.
      if (this.mode !== 'step') this.phase = (this.phase + dt * GROOVE_PHASE_RATE * speed) % TAU;
      const fade = settling ? bounded(1 - Math.max(0, age - GROOVE_AFTER) / (RECOVER_END - GROOVE_AFTER), 0, 1) : 1;
      this.energy *= Math.exp(-dt * (settling ? 1.8 : 0.22));
      const result = this.buildMotion(state, Math.max(0.3, this.energy) * fade);
      result.speech = this.speechQueue.shift();
      return result;
    }

    this.energy = 0;
    // Idle micro-motion follows the same capped visual clock, so a background
    // suspension does not change the pose abruptly on the first resumed paint.
    if (this.mode !== 'step') this.phase = (this.phase + dt) % TAU;
    const result = this.buildMotion(state, 0);
    result.speech = this.speechQueue.shift();
    return result;
  }

  private transition(next: BehaviorClip, at: number, restart = false): void {
    if (this.behavior === next && this.behaviorAt !== undefined && !restart) return;
    if (this.behavior === 'groove' && this.behaviorAt !== undefined) {
      this.grooveResumeMs = (this.clipPlayheadMs + this.grooveOffsetMs) % CLIP_DURATION_MS.groove;
    }
    const resumingPhrase = this.behavior === 'settle' || this.behavior === 'recover';
    this.grooveOffsetMs = next === 'groove' && resumingPhrase ? this.grooveResumeMs : 0;
    this.behavior = next;
    this.behaviorAt = Number.isFinite(at) ? at : 0;
    this.clipPlayheadMs = 0;
  }

  private buildMotion(behavior: BehaviorClip, energy: number): Motion {
    const state: MotionState = behavior === 'sleep' ? 'sleeping'
      : behavior === 'settle' || behavior === 'recover' ? 'settling'
        : behavior === 'idle' ? 'idle' : 'dancing';
    const clipElapsedMs = this.clipPlayheadMs;
    const duration = this.mode === 'step' && behavior === 'recover' ? 200 : CLIP_DURATION_MS[behavior];
    const looping = behavior === 'idle' || behavior === 'sleep' || behavior === 'groove';
    const clipProgress = this.mode === 'step' && behavior === 'groove'
      ? ((this.phase % TAU) + TAU) % TAU / TAU
      : looping ? ((clipElapsedMs + (behavior === 'groove' ? this.grooveOffsetMs : 0)) % duration) / duration
        : Math.min(1, clipElapsedMs / duration);
    return {
      phase: this.phase, energy: bounded(energy, 0, 1), state, behavior, clip: behavior,
      clipElapsedMs, clipProgress,
      frameIndex: this.isExactStep() ? this.exactFrame : undefined,
    };
  }

  private isExactStep(): boolean {
    return this.profile === 'dancingFox' && this.mode === 'step';
  }

  /** Hold the exact pose and its idle deadline while the user drags the pet. */
  setSuspended(value: boolean, now: number): void {
    if (!Number.isFinite(now)) return;
    if (value && this.suspendedAt === undefined) this.suspendedAt = now;
    if (!value && this.suspendedAt !== undefined) {
      const elapsed = Math.max(0, now - this.suspendedAt);
      this.lastPulse += elapsed;
      this.lastActivity += elapsed;
      this.suspendedAt = undefined;
    }
  }

  private maybeSpeak(kind: SpeechTrigger['kind'], at: number, source?: ActivitySource): void {
    if (at - this.speechAt < SPEECH_COOLDOWN && kind !== 'pet' && kind !== 'click') return;
    // Pet/click feedback is immediate but still coalesced with an existing
    // queue item, preventing a rapid click burst from flooding the UI.
    if (this.speechQueue.length > 0 && (kind === 'pet' || kind === 'click')) return;
    this.speechAt = at;
    this.speechQueue.push({ id: ++this.speechId, kind, at, source });
  }
}

/** Existing callers keep using DanceEngine; the richer controller is additive. */
export class DanceEngine extends BehaviorController {}
