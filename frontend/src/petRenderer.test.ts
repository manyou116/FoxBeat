import { describe, expect, it } from 'vitest';
import { getVectorPose, type Animal, type RenderOptions } from './petRenderer';
import type { BehaviorClip } from './engine';

const drawn: Animal[] = ['fox', 'emojiFox', 'girl', 'cat', 'capybara'];

function options(animal: Animal, clip: BehaviorClip, progress: number): RenderOptions {
  return {
    animal, clip, clipProgress: progress, phase: Math.PI / 2,
    dance: 'wave', energy: 0.85,
    state: clip === 'idle' ? 'idle' : clip === 'sleep' ? 'sleeping' : 'dancing',
  };
}

describe('drawn companion choreography', () => {
  it('brings greeting and petting gestures back to the resting pose', () => {
    for (const animal of drawn) {
      for (const clip of ['greet', 'pet'] as const) {
        const start = getVectorPose(options(animal, clip, 0));
        const peak = getVectorPose(options(animal, clip, 0.5));
        const end = getVectorPose(options(animal, clip, 1));
        expect(end).toEqual(start);
        expect(peak.rightArm === start.rightArm && peak.head === start.head).toBe(false);
      }
    }
  });

  it('gives each companion a distinct wave while keeping the quieter setting quiet', () => {
    const arms = drawn.map((animal) => getVectorPose(options(animal, 'groove', 0.25)).rightArm);
    expect(new Set(arms.map((angle) => Math.round(angle))).size).toBe(drawn.length);
    for (const animal of drawn) {
      const normal = getVectorPose(options(animal, 'greet', 0.5));
      const quiet = getVectorPose({ ...options(animal, 'greet', 0.5), reducedMotion: true });
      const rest = getVectorPose(options(animal, 'greet', 0));
      expect(Math.abs(quiet.rightArm - rest.rightArm)).toBeLessThan(Math.abs(normal.rightArm - rest.rightArm));
    }
  });

  it('waits for whip contact before flinching and finishes at the resting pose', () => {
    for (const animal of ['fox', 'emojiFox'] as const) {
      const rest = getVectorPose(options(animal, 'whip', 0));
      expect(getVectorPose(options(animal, 'whip', 0.4))).toEqual(rest);
      const recoil = getVectorPose(options(animal, 'whip', 0.52));
      expect(recoil.x).toBeLessThan(rest.x);
      expect(recoil.y).toBeLessThan(rest.y);
      expect(getVectorPose(options(animal, 'whip', 1))).toEqual(rest);
    }
  });

  it('keeps all poses finite through clip boundaries and dance types', () => {
    for (const animal of drawn) {
      for (const dance of ['sway', 'step', 'wave'] as const) {
        for (const clip of ['idle', 'anticipation', 'groove', 'settle', 'recover', 'sleep', 'pet', 'greet', 'whip', 'whip-hard'] as const) {
          for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
            const pose = getVectorPose({ ...options(animal, clip, progress), dance });
            expect(Object.values(pose).filter((value) => typeof value === 'number').every(Number.isFinite)).toBe(true);
          }
        }
      }
    }
  });

  it('makes the strong recoil larger, honors reduced motion, and returns to rest', () => {
    for (const animal of ['fox', 'emojiFox'] as const) {
      const rest = getVectorPose(options(animal, 'whip-hard', 0));
      expect(getVectorPose(options(animal, 'whip-hard', 0.29))).toEqual(rest);
      const gentle = getVectorPose(options(animal, 'whip', 0.52));
      const strong = getVectorPose(options(animal, 'whip-hard', 0.53));
      expect(strong.x).toBeLessThan(gentle.x);
      expect(strong.y).toBeLessThan(gentle.y);
      const quiet = getVectorPose({ ...options(animal, 'whip-hard', 0.53), reducedMotion: true });
      expect(Math.abs(quiet.x - rest.x)).toBeLessThan(Math.abs(strong.x - rest.x));
      expect(getVectorPose(options(animal, 'whip-hard', 1))).toEqual(rest);
    }
  });
});
