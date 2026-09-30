import { describe, expect, it } from 'vitest';
import { HARD_WHIP_CONTACTS, whipRecoil, whipStrike } from './whipAnimation';

describe('strong whip contact timing', () => {
  it('keeps the tip on the hip briefly for every strike before pulling it away', () => {
    for (const contact of HARD_WHIP_CONTACTS) {
      expect(whipStrike(contact - 0.08, true).reach).toBeCloseTo(0);
      expect(whipStrike(contact, true).reach).toBeCloseTo(1);
      expect(whipStrike(contact + 0.02, true).reach).toBeCloseTo(1);
      expect(whipStrike(contact + 0.105, true).reach).toBeLessThan(0.02);
    }
  });

  it('has three recoil peaks and fully settles before the clip ends', () => {
    expect(whipRecoil(0.29, true)).toBe(0);
    HARD_WHIP_CONTACTS.forEach((contact, index) => {
      expect(whipRecoil(contact + 0.04, true)).toBeCloseTo(0.8 + index * 0.2);
    });
    expect(whipRecoil(0.99, true)).toBe(0);
    expect(whipStrike(1, true).reach).toBe(0);
  });
});
