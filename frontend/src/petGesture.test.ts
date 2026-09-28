import { describe, expect, it } from 'vitest';
import { PetGesture } from './petGesture';

describe('direct desktop pet interaction', () => {
  it('treats small hand jitter as a click', () => {
    const g = new PetGesture(); g.down(1, 100, 100);
    expect(g.move(1, 102, 103)).toBe(false);
    g.end(); expect(g.click()).toBe(true);
  });
  it('starts one drag and suppresses the click after release', () => {
    const g = new PetGesture(); g.down(1, 100, 100);
    expect(g.move(1, 106, 100)).toBe(true);
    expect(g.move(1, 130, 100)).toBe(false);
    g.end(); expect(g.click()).toBe(false);
    g.down(2, 130, 100); g.end(); expect(g.click()).toBe(true);
  });
  it('ignores another pointer and cancels without petting', () => {
    const g = new PetGesture(); g.down(1, 0, 0);
    expect(g.move(2, 20, 20)).toBe(false);
    g.cancel(); expect(g.click()).toBe(false);
    expect(g.move(1, 20, 20)).toBe(false);
  });
});
