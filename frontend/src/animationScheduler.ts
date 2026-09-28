export interface AnimationClock {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

interface AnimationSchedulerOptions {
  /** Draw one frame and return the delay before the next frame, in milliseconds. */
  paint: () => number;
  isHidden: () => boolean;
  isPaused: () => boolean;
  runInBackground: () => boolean;
  clock?: AnimationClock;
}

const browserClock: AnimationClock = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: handle => window.clearTimeout(handle),
  requestAnimationFrame: callback => window.requestAnimationFrame(callback),
  cancelAnimationFrame: handle => window.cancelAnimationFrame(handle),
};

/**
 * Owns one animation chain. Transparent desktop WebViews can report hidden while
 * visibly onscreen, and their RAF can stop; desktop pets therefore use timers.
 * Preview canvases retain normal page-visibility and RAF behavior.
 */
export function createAnimationScheduler(options: AnimationSchedulerOptions) {
  const clock = options.clock ?? browserClock;
  let timer: number | undefined;
  let frame: number | undefined;
  let disposed = false;
  let painting = false;

  const canPaint = () => !disposed && !options.isPaused()
    && (options.runInBackground() || !options.isHidden());

  const cancelPending = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    if (frame !== undefined) clock.cancelAnimationFrame(frame);
    timer = undefined;
    frame = undefined;
  };

  const paintAndSchedule = () => {
    if (!canPaint() || painting) return;
    painting = true;
    let delay: number;
    try { delay = options.paint(); }
    finally { painting = false; }
    if (!canPaint()) return;
    const boundedDelay = Number.isFinite(delay) ? Math.max(1, delay) : 125;
    timer = clock.setTimeout(() => {
      timer = undefined;
      if (!canPaint()) return;
      if (options.runInBackground()) {
        paintAndSchedule();
      } else {
        frame = clock.requestAnimationFrame(() => {
          frame = undefined;
          paintAndSchedule();
        });
      }
    }, boundedDelay);
  };

  return {
    /** Also synchronizes pause / visibility changes and cancels stale frames. */
    requestPaint() {
      if (disposed) return;
      cancelPending();
      paintAndSchedule();
    },
    dispose() {
      disposed = true;
      cancelPending();
    },
  };
}
