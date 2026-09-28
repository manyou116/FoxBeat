export interface PreviewKey {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  altGraph?: boolean;
  isComposing?: boolean;
  editable: boolean;
  button: boolean;
}

/** Filter window-local preview input without changing text fields or UI shortcuts. */
export function isPreviewPulseKey(event: PreviewKey): boolean {
  if (event.editable || event.repeat) return false;
  if (event.metaKey || (event.ctrlKey && !event.altGraph) || (event.altKey && !event.altGraph)) return false;
  if (event.button && (event.key === 'Enter' || event.key === ' ')) return false;
  if (event.key.length === 1) return true;
  if (event.isComposing && event.key === 'Process') return true;
  return ['Enter', 'Backspace', 'Delete'].includes(event.key);
}
