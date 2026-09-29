import { describe, expect, it } from 'vitest';
import { selectBitmapFrame } from './bitmapAnimation';

const base = { clip: 'groove' as const, dance: 'sway' as const, phase: 0 };

describe('bitmap companion frame selection', () => {
  it('loops the 24-frame dance and follows step-mode progress', () => {
    expect(selectBitmapFrame({ ...base, clipProgress: 0 })).toEqual({ atlas: 'sway', frame: 0 });
    expect(selectBitmapFrame({ ...base, clipProgress: 1 / 24 })).toEqual({ atlas: 'sway', frame: 1 });
    expect(selectBitmapFrame({ ...base, clipProgress: 0.999 })).toEqual({ atlas: 'sway', frame: 23 });
    expect(selectBitmapFrame({ ...base, clipProgress: 1 })).toEqual({ atlas: 'sway', frame: 0 });
    expect(selectBitmapFrame({ ...base, dance: 'step', clipProgress: 0.25 })).toEqual({ atlas: 'step', frame: 6 });
    expect(selectBitmapFrame({ ...base, dance: 'wave', clipProgress: 0.5 })).toEqual({ atlas: 'wave', frame: 12 });
  });

  it('reaches the final pose of one-shot reactions', () => {
    expect(selectBitmapFrame({ ...base, clip: 'greet', clipProgress: 1 })).toEqual({ atlas: 'actions', frame: 15 });
    expect(selectBitmapFrame({ ...base, clip: 'greet', clipProgress: 0.5 })).toEqual({ atlas: 'actions', frame: 7 });
    expect(selectBitmapFrame({ ...base, clip: 'anticipation', clipElapsedMs: 240 })).toEqual({ atlas: 'actions', frame: 15 });
  });

  it('settles from the visible dance frame toward a matching neutral pose', () => {
    const outgoing = { atlas: 'sway' as const, frame: 8 };
    expect(selectBitmapFrame({ ...base, clip: 'settle', clipProgress: 0, settleFrom: outgoing })).toEqual(outgoing);
    expect(selectBitmapFrame({ ...base, clip: 'settle', clipProgress: 1, settleFrom: outgoing })).toEqual({ atlas: 'sway', frame: 12 });
  });

  it('uses quiet artwork when reduced motion is enabled', () => {
    expect(selectBitmapFrame({ ...base, clipProgress: 0.25, reducedMotion: true })).toEqual({ atlas: 'actions', frame: 0 });
    expect(selectBitmapFrame({ ...base, clipProgress: 0.5, reducedMotion: true })).toEqual({ atlas: 'actions', frame: 0 });
    expect(selectBitmapFrame({ ...base, clip: 'sleep', reducedMotion: true })).toEqual({ atlas: 'actions', frame: 14 });
  });
});
