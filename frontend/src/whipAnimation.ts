export const WHIP_CONTACT_PROGRESS = 0.42;
export const HARD_WHIP_CONTACTS = [0.3, 0.49, 0.68] as const;

export function isWhipClip(clip?: string): boolean {
  return clip === 'whip' || clip === 'whip-hard';
}

export function smoothStep(value: number): number {
  const t = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return t * t * (3 - 2 * t);
}

/** The flinch starts at contact and eases back to rest after the short hop. */
export function whipRecoil(progress: number, hard = false): number {
  if (hard) {
    return HARD_WHIP_CONTACTS.reduce((total, contact, index) => {
      const elapsed = progress - contact;
      const fall = index === 2 ? 0.26 : 0.14;
      const pulse = elapsed <= 0 ? 0 : elapsed < 0.04 ? smoothStep(elapsed / 0.04)
        : 1 - smoothStep((elapsed - 0.04) / fall);
      return total + pulse * (0.8 + index * 0.2);
    }, 0);
  }
  if (progress <= WHIP_CONTACT_PROGRESS) return 0;
  if (progress < 0.52) return smoothStep((progress - WHIP_CONTACT_PROGRESS) / 0.1);
  return 1 - smoothStep((progress - 0.52) / 0.42);
}

/** Shared contact clock for the lash, impact marks, and bitmap expressions. */
export function whipStrike(progress: number, hard = false) {
  const contact = hard
    ? HARD_WHIP_CONTACTS.reduce((latest, value) => progress >= value - 0.11 ? value : latest, HARD_WHIP_CONTACTS[0] as number)
    : WHIP_CONTACT_PROGRESS;
  const snap = smoothStep((progress - (hard ? contact - 0.08 : 0.22)) / (hard ? 0.08 : contact - 0.22));
  const rebound = smoothStep((progress - (hard ? contact + 0.025 : 0.47)) / (hard ? 0.085 : 0.2));
  const impactDuration = hard ? 0.1 : 0.14;
  const elapsed = progress - contact;
  const impact = elapsed >= 0 && elapsed < impactDuration ? Math.sin(elapsed / impactDuration * Math.PI) : 0;
  return { contact, snap, rebound, reach: snap * (1 - rebound), impact };
}
