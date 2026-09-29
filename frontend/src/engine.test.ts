import { describe, it, expect } from 'vitest';
import { CLIP_DURATION_MS, DanceEngine } from './engine';

function sampleEvery(engine: DanceEngine, from: number, to: number, interval = 40) {
  for (let at = from + interval; at < to; at += interval) engine.sample(at);
  return engine.sample(to);
}

describe('anonymous input animation clock', () => {
  it('responds immediately, settles then sleeps without accumulating pulses', () => {
    const e = new DanceEngine();
    expect(e.sample(0).state).toBe('idle');
    e.pulse(1, 10);
    expect(e.sample(10).state).toBe('dancing');
    expect(e.sample(2810).state).toBe('settling');
    expect(e.sample(3910).state).toBe('idle');
    expect(e.sample(31000).state).toBe('sleeping');
    e.pulse(1, 32000);
    expect(e.sample(32000).state).toBe('dancing');
  });
  it('holds a step until another input and returns to idle after two seconds', () => {
    const e = new DanceEngine(); e.configure('step');
    e.pulse(1, 0);
    const first = e.sample(0).phase;
    expect(e.sample(600).phase).toBe(first);
    e.pulse(1, 650);
    expect(e.sample(650).phase).toBeCloseTo(first * 2);
    expect(e.sample(2700).state).toBe('idle');
  });
  it('clears old input on mode changes and bounds abnormal bursts', () => {
    const e = new DanceEngine(); e.pulse(10_000, 0);
    expect(e.sample(0).energy).toBeLessThanOrEqual(1);
    e.configure('step'); expect(e.sample(10).state).toBe('idle');
    e.pulse(Number.NaN, 20); expect(e.sample(20).state).toBe('idle');
  });
  it('does not jump after a background suspension', () => {
    const e = new DanceEngine();
    e.sample(0, true);
    const before = e.sample(33, true);
    const after = e.sample(100_000, true);
    expect(after.phase - before.phase).toBeLessThan(0.2);
    expect(after.clip).toBe('groove');
    expect(after.clipElapsedMs - before.clipElapsedMs).toBe(64);
    expect(Math.floor(after.clipProgress * 36) - Math.floor(before.clipProgress * 36)).toBeLessThanOrEqual(1);
  });

  it('uses wall time for inactivity even when only one visual frame passes', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(0);
    expect(e.sample(100_000)).toMatchObject({ clip: 'sleep', clipElapsedMs: 0, clipProgress: 0 });
  });

  it('exposes a continuous anticipation, groove, settle and recovery clip', () => {
    const e = new DanceEngine();
    e.pulse(1, 10);
    expect(e.sample(10).behavior).toBe('anticipation');
    expect(e.sample(250).behavior).toBe('groove');
    expect(e.sample(2_810).behavior).toBe('settle');
    expect(e.sample(3_310).behavior).toBe('recover');
    expect(e.sample(3_810).behavior).toBe('idle');
  });

  it('gives reactions independent timelines and finishes a complete groove phrase', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(0);
    expect(sampleEvery(e, 0, 120)).toMatchObject({ clip: 'anticipation', clipElapsedMs: 120, clipProgress: 0.5 });
    expect(sampleEvery(e, 120, 240)).toMatchObject({ clip: 'groove', clipElapsedMs: 0, clipProgress: 0 });
    expect(sampleEvery(e, 240, 1_520).clipProgress).toBeCloseTo(0.5);
    expect(sampleEvery(e, 1_520, 2_800)).toMatchObject({ clip: 'settle', clipProgress: 0 });
    expect(sampleEvery(e, 2_800, 3_050, 50)).toMatchObject({ clip: 'settle', clipProgress: 0.5 });
    expect(sampleEvery(e, 3_050, 3_550, 50)).toMatchObject({ clip: 'recover', clipProgress: 0.5 });
    expect(CLIP_DURATION_MS.groove).toBe(2_560);
  });

  it('resumes the groove at its earlier position when input interrupts the settling tail', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(0);
    sampleEvery(e, 0, 400);
    e.pulse(1, 500);
    sampleEvery(e, 400, 500, 20);
    expect(sampleEvery(e, 500, 3_300).behavior).toBe('settle');
    const before = e.sample(3_300).phase;
    e.pulse(1, 3_400);
    const motion = e.sample(3_400);
    expect(motion.behavior).toBe('groove');
    expect(motion.phase).toBeGreaterThanOrEqual(before);
    expect(motion.clipProgress).toBeCloseTo(500 / CLIP_DURATION_MS.groove);
  });

  it('does not restart the groove clock on every pulse', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(0);
    sampleEvery(e, 0, 240);
    const first = sampleEvery(e, 240, 1_000).clipProgress;
    e.pulse(1, 1_000);
    const next = e.sample(1_033);
    expect(next.clip).toBe('groove');
    expect(next.clipProgress).toBeGreaterThan(first);
  });

  it('keeps the selected bitmap pose fixed in step mode until another input', () => {
    const e = new DanceEngine();
    e.configure('step');
    e.pulse(1, 0);
    const first = e.sample(300).clipProgress;
    expect(e.sample(1_000).clipProgress).toBe(first);
    e.pulse(1, 1_001);
    expect(e.sample(1_001).clipProgress).toBeGreaterThan(first);
  });

  it('finishes a greeting or pet without an unrelated late settle', () => {
    const e = new DanceEngine();
    e.click(0);
    e.sample(0);
    expect(sampleEvery(e, 0, 425, 25)).toMatchObject({ clip: 'greet', clipProgress: 0.5 });
    expect(e.sample(900).clip).toBe('idle');
    expect(e.sample(2_900).clip).toBe('idle');
    e.pet(10_000);
    e.sample(10_000);
    expect(sampleEvery(e, 10_000, 10_600)).toMatchObject({ clip: 'pet', clipProgress: 0.5 });
    expect(e.sample(11_200).clip).toBe('idle');
    expect(e.sample(12_900).clip).toBe('idle');
  });

  it('restarts a repeated pet action from the second touch', () => {
    const e = new DanceEngine();
    e.pet(0);
    e.sample(0);
    expect(sampleEvery(e, 0, 1_100, 50).clipProgress).toBeCloseTo(1_100 / 1_200);
    e.pet(1_100);
    expect(e.sample(1_100)).toMatchObject({ clip: 'pet', clipElapsedMs: 0, clipProgress: 0 });
    expect(sampleEvery(e, 1_100, 2_200, 50).clip).toBe('pet');
    expect(e.sample(2_300).clip).toBe('idle');
  });

  it('starts a new neutral dance phrase after a pet reaction', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(0);
    expect(sampleEvery(e, 0, 1_000).clipProgress).toBeGreaterThan(0);
    e.pet(1_000);
    e.sample(1_000);
    e.pulse(1, 1_100);
    expect(e.sample(2_200)).toMatchObject({ clip: 'groove', clipProgress: 0 });
  });

  it('emits one semantic speech trigger for interaction events', () => {
    const e = new DanceEngine();
    e.pulse(1, 0, 'keyboard');
    expect(e.consumeSpeech()).toMatchObject({ kind: 'pulse', source: 'keyboard' });
    expect(e.consumeSpeech()).toBeUndefined();
    e.pet(100);
    expect(e.sample(100).speech?.kind).toBe('pet');
    e.click(200);
    expect(e.sample(200).speech?.kind).toBe('click');
  });

  it('supports explicit idle events and emits a sleep trigger after long inactivity', () => {
    const e = new DanceEngine();
    e.idle(0);
    expect(e.sample(0).speech?.kind).toBe('idle');
    expect(e.sample(30_001).behavior).toBe('sleep');
    // The sleep trigger is delivered once even if the next paint is immediate.
    expect(e.sample(30_010).speech).toBeUndefined();
  });

  it('keeps the next groove aligned with the phase shown during idle', () => {
    const e = new DanceEngine();
    e.pulse(1, 0);
    e.sample(200);
    const idle = e.sample(5_000);
    expect(idle.state).toBe('idle');
    e.pulse(1, 5_000);
    expect(e.sample(5_000).phase).toBeCloseTo(idle.phase % (Math.PI * 2));
  });
});
