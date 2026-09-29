import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnimationScheduler, type AnimationClock } from './animationScheduler';
import { CLIP_DURATION_MS, DanceEngine, type Motion } from './engine';

function fixture(background = false, initiallyHidden = false) {
  const state = { hidden: initiallyHidden, paused: false, background };
  const paint = vi.fn(() => 33);
  const raf = vi.fn((callback: FrameRequestCallback) => Number(setTimeout(() => callback(Date.now()), 16)));
  const clock: AnimationClock = {
    setTimeout: (callback, delay) => Number(setTimeout(callback, delay)),
    clearTimeout: handle => clearTimeout(handle),
    requestAnimationFrame: raf,
    cancelAnimationFrame: handle => clearTimeout(handle),
  };
  const scheduler = createAnimationScheduler({
    paint, clock,
    isHidden: () => state.hidden,
    isPaused: () => state.paused,
    runInBackground: () => state.background,
  });
  return { state, paint, raf, clock, scheduler };
}

describe('desktop and preview animation scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('keeps painting a desktop pet while its WebView reports hidden, without RAF', () => {
    const f = fixture(true, true);
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(99);
    expect(f.paint).toHaveBeenCalledTimes(4);
    expect(f.raf).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('suspends hidden previews and resumes only one chain when they become visible', () => {
    const f = fixture(false, true);
    f.scheduler.requestPaint();
    expect(f.paint).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    f.state.hidden = false;
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(49);
    expect(f.paint).toHaveBeenCalledTimes(2);
    f.state.hidden = true;
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(1000);
    expect(f.paint).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    f.state.hidden = false;
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(49);
    expect(f.paint).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels a pending preview RAF when an input asks for immediate repaint', () => {
    const f = fixture();
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(33); // One RAF is now waiting.
    expect(f.raf).toHaveBeenCalledTimes(1);
    f.scheduler.requestPaint();
    expect(f.paint).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16); // The cancelled frame must not paint.
    expect(f.paint).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(33);
    expect(f.paint).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('honors an explicit app pause even when desktop background painting is enabled', () => {
    const f = fixture(true, true);
    f.scheduler.requestPaint();
    f.state.paused = true;
    f.scheduler.requestPaint();
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(1000);
    expect(f.paint).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    f.state.paused = false;
    f.scheduler.requestPaint();
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(33);
    expect(f.paint).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each([false, true])('disposes pending work permanently (background=%s)', background => {
    const f = fixture(background);
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(33);
    const count = f.paint.mock.calls.length;
    f.scheduler.dispose();
    f.scheduler.dispose();
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(1000);
    expect(f.paint).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks visibility before executing an already queued preview frame', () => {
    const f = fixture();
    f.scheduler.requestPaint();
    vi.advanceTimersByTime(33);
    f.state.hidden = true;
    vi.advanceTimersByTime(16);
    expect(f.paint).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advances real dance phases after a pulse in a hidden desktop WebView', () => {
    const f = fixture(true, true);
    const engine = new DanceEngine();
    const motions: Motion[] = [];
    const scheduler = createAnimationScheduler({
      clock: f.clock,
      isHidden: () => true,
      isPaused: () => false,
      runInBackground: () => true,
      paint: () => { motions.push(engine.sample(Date.now())); return 33; },
    });
    scheduler.requestPaint();
    expect(motions.at(-1)?.state).toBe('idle');
    engine.pulse(1, Date.now());
    scheduler.requestPaint();
    const first = motions.at(-1)!;
    expect(first.state).toBe('dancing');
    vi.advanceTimersByTime(495);
    const last = motions.at(-1)!;
    expect(last.state).toBe('dancing');
    // The hidden desktop WebView still paints each frame. After the 240ms
    // lead-in, the groove advances on its own visual clock.
    expect(last.clip).toBe('groove');
    expect(last.clipElapsedMs).toBeGreaterThan(200);
    expect(last.clipElapsedMs).toBeLessThan(300);
    expect(last.clipProgress).toBeCloseTo(last.clipElapsedMs / CLIP_DURATION_MS.groove);
    expect(last.phase).toBeGreaterThan(first.phase);
    expect(last.energy).toBeGreaterThan(0);
    expect(f.raf).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
