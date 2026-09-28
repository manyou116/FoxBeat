import { describe, it, expect } from 'vitest';
import { DanceEngine } from './engine';

describe('anonymous input animation clock', () => {
  it('responds immediately, settles then sleeps without accumulating pulses', () => {
    const e = new DanceEngine();
    expect(e.sample(0).state).toBe('idle');
    e.pulse(1, 10);
    expect(e.sample(10).state).toBe('dancing');
    expect(e.sample(1510).state).toBe('settling');
    expect(e.sample(2400).state).toBe('idle');
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
    const e = new DanceEngine(); e.sample(0, true);
    expect(e.sample(100_000, true).phase).toBeLessThan(1);
  });
});
