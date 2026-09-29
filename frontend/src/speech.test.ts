import { describe, expect, it } from 'vitest';
import { SpeechDirector } from './speech';

describe('speech director', () => {
  it('uses anonymous events and suppresses rapid chatter', () => {
    const director = new SpeechDirector();
    const first = director.trigger('orangeFox', 'first-input', 1_000, true);
    expect(first).toBeTruthy();
    expect(director.trigger('orangeFox', 'burst', 2_000, true)).toBeUndefined();
    expect(director.trigger('orangeFox', 'burst', 20_000, true)).toBeTruthy();
  });

  it('can be disabled and does not repeat idle lines forever', () => {
    const director = new SpeechDirector();
    expect(director.trigger('yuexinCat', 'launch', 0, false)).toBeUndefined();
    expect(director.trigger('yuexinCat', 'idle', 10_000, true)).toBeTruthy();
    expect(director.trigger('yuexinCat', 'idle', 40_000, true)).toBeUndefined();
    expect(director.trigger('yuexinCat', 'long-idle', 60_000, true)).toBeTruthy();
  });
});
