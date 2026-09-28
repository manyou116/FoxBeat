export type Mode = 'continuous' | 'step';
export type MotionState = 'idle' | 'dancing' | 'settling' | 'sleeping';
export interface Motion { phase: number; energy: number; state: MotionState }

/** Only anonymous pulse counts enter this clock; no key or text is retained. */
export class DanceEngine {
  private phase = 0;
  private energy = 0;
  private lastPulse = Number.NEGATIVE_INFINITY;
  private lastTime: number | undefined;
  private created: number | undefined;
  private mode: Mode = 'continuous';
  private sensitivity = 1;

  configure(mode: Mode, sensitivity = 1) {
    if (this.mode !== mode) this.reset();
    this.mode = mode;
    this.sensitivity = Math.min(1.5, Math.max(0.5, sensitivity));
  }

  reset() {
    this.phase = 0;
    this.energy = 0;
    this.lastPulse = Number.NEGATIVE_INFINITY;
    this.lastTime = undefined;
    this.created = undefined;
  }

  pulse(count: number, now: number) {
    if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(now)) return;
    const bounded = Math.min(12, Math.floor(count));
    this.lastPulse = now;
    this.created ??= now;
    this.energy = Math.min(1, Math.max(0.35, this.energy + bounded * 0.11 * this.sensitivity));
    if (this.mode === 'step') this.phase = (this.phase + bounded * Math.PI / 12) % (Math.PI * 2);
  }

  sample(now: number, autoplay = false): Motion {
    this.created ??= now;
    const dt = this.lastTime === undefined ? 0 : Math.max(0, Math.min(0.1, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const age = now - this.lastPulse;
    const inactive = Number.isFinite(this.lastPulse) ? age : now - this.created;
    if (autoplay) {
      this.phase = (this.phase + dt * Math.PI * 1.6) % (Math.PI * 2);
      return {phase: this.phase, energy: 0.78, state: 'dancing'};
    }
    if (this.mode === 'step') {
      if (age < 2000) return {phase: this.phase, energy: 0.8, state: 'dancing'};
      this.phase = 0;
      this.energy = 0;
      return {phase: now / 1000, energy: 0, state: inactive > 30_000 ? 'sleeping' : 'idle'};
    }
    const settling = age >= 1400 && age < 2300;
    if (age < 2300) {
      const fade = settling ? Math.max(0, 1 - (age - 1400) / 900) : 1;
      this.energy *= Math.exp(-dt * (settling ? 1.8 : 0.22));
      this.phase = (this.phase + dt * Math.PI * 1.6 * (0.86 + this.energy * 0.28)) % (Math.PI * 2);
      return {phase: this.phase, energy: Math.max(0.3, this.energy) * fade, state: settling ? 'settling' : 'dancing'};
    }
    this.energy = 0;
    return {phase: now / 1000, energy: 0, state: inactive > 30_000 ? 'sleeping' : 'idle'};
  }
}
