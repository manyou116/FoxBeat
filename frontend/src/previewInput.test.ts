import { describe, expect, it } from 'vitest';
import { isPreviewPulseKey, type PreviewKey } from './previewInput';

const key = (patch: Partial<PreviewKey> = {}): PreviewKey => ({
  key: 'a', repeat: false, ctrlKey: false, metaKey: false, altKey: false,
  editable: false, button: false, ...patch,
});

describe('window-local typing preview', () => {
  it('accepts ordinary typing and editing keys in the preview window', () => {
    for (const value of ['a', 'A', '你', ' ', '1', 'Enter', 'Backspace', 'Delete']) {
      expect(isPreviewPulseKey(key({ key: value })), value).toBe(true);
    }
  });

  it('leaves editable controls and held keys alone', () => {
    expect(isPreviewPulseKey(key({ editable: true }))).toBe(false);
    expect(isPreviewPulseKey(key({ repeat: true }))).toBe(false);
  });

  it('preserves modifier keys, navigation and common shortcuts', () => {
    for (const value of ['Tab', 'Escape', 'Shift', 'Control', 'Meta', 'Alt', 'CapsLock', 'F5', 'ArrowDown']) {
      expect(isPreviewPulseKey(key({ key: value })), value).toBe(false);
    }
    expect(isPreviewPulseKey(key({ metaKey: true }))).toBe(false);
    expect(isPreviewPulseKey(key({ ctrlKey: true }))).toBe(false);
    expect(isPreviewPulseKey(key({ altKey: true }))).toBe(false);
  });

  it('does not count Enter or Space used to activate another button', () => {
    expect(isPreviewPulseKey(key({ key: 'Enter', button: true }))).toBe(false);
    expect(isPreviewPulseKey(key({ key: ' ', button: true }))).toBe(false);
    expect(isPreviewPulseKey(key({ key: 'a', button: true }))).toBe(true);
  });

  it('keeps AltGraph and composition keystrokes available without reading committed text', () => {
    expect(isPreviewPulseKey(key({ key: '@', altKey: true, ctrlKey: true, altGraph: true }))).toBe(true);
    expect(isPreviewPulseKey(key({ key: 'Process', isComposing: true }))).toBe(true);
    expect(isPreviewPulseKey(key({ key: 'Process' }))).toBe(false);
  });
});
