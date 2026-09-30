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

  it('plays the orange fox wink reaction once and holds its key pose in quiet mode', () => {
    const wink = { ...base, animal: 'orangeFox' as const, clip: 'pet' as const };
    expect(selectBitmapFrame({ ...wink, clipProgress: 0 })).toEqual({ atlas: 'wink', frame: 0 });
    expect(selectBitmapFrame({ ...wink, clipProgress: 0.5 })).toEqual({ atlas: 'wink', frame: 6 });
    expect(selectBitmapFrame({ ...wink, clipProgress: 1 })).toEqual({ atlas: 'wink', frame: 11 });
    expect(selectBitmapFrame({ ...wink, clipProgress: 0.5, reducedMotion: true })).toEqual({ atlas: 'wink', frame: 6 });
    expect(selectBitmapFrame({ ...base, animal: 'shyFox', clip: 'pet', clipProgress: 0.5 })).toEqual({ atlas: 'actions', frame: 9 });
  });

  it('uses the fox recoil poses and returns to neutral after the whip', () => {
    const reaction = { ...base, animal: 'shyFox' as const, clip: 'whip' as const };
    expect(selectBitmapFrame({ ...reaction, clipProgress: 0 })).toEqual({ atlas: 'actions', frame: 0 });
    expect(selectBitmapFrame({ ...reaction, clipProgress: 0.4 })).toEqual({ atlas: 'actions', frame: 0 });
    expect(selectBitmapFrame({ ...reaction, clipProgress: 0.43 })).toEqual({ atlas: 'actions', frame: 2 });
    expect(selectBitmapFrame({ ...reaction, clipProgress: 0.55 })).toEqual({ atlas: 'actions', frame: 7 });
    expect(selectBitmapFrame({ ...reaction, animal: 'orangeFox', clipProgress: 0.55 })).toEqual({ atlas: 'actions', frame: 4 });
    expect(selectBitmapFrame({ ...reaction, clipProgress: 1 })).toEqual({ atlas: 'actions', frame: 0 });
  });

  it('synchronizes the strong reaction expressions with each of its three contacts', () => {
    const reaction = { ...base, animal: 'orangeFox' as const, clip: 'whip-hard' as const };
    expect(selectBitmapFrame({ ...reaction, clipProgress: 0.29 }).frame).toBe(0);
    for (const contact of [0.3, 0.49, 0.68]) {
      expect(selectBitmapFrame({ ...reaction, clipProgress: contact + 0.01 }).frame).toBe(2);
      expect(selectBitmapFrame({ ...reaction, clipProgress: contact + 0.06 }).frame).toBe(4);
      expect(selectBitmapFrame({ ...reaction, clipProgress: contact + 0.06, reducedMotion: true }).frame).toBe(1);
    }
    expect(selectBitmapFrame({ ...reaction, clipProgress: 1 }).frame).toBe(0);
  });
});
