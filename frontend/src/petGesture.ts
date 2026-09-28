/** Distinguish a deliberate drag from small pointer jitter while petting. */
export class PetGesture {
  private origin: { id: number; x: number; y: number } | undefined;
  private dragged = false;

  down(id: number, x: number, y: number) {
    this.origin = { id, x, y };
    this.dragged = false;
  }

  move(id: number, x: number, y: number): boolean {
    if (!this.origin || this.origin.id !== id || this.dragged) return false;
    if (Math.hypot(x - this.origin.x, y - this.origin.y) < 5) return false;
    this.dragged = true;
    return true;
  }

  end() { this.origin = undefined; }
  isDragging() { return this.origin !== undefined && this.dragged; }
  cancel() { this.origin = undefined; this.dragged = true; }
  click(): boolean {
    this.origin = undefined;
    // Keep suppressing any compatibility click until a fresh pointer down.
    return !this.dragged;
  }
}
