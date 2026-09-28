import { useEffect, useRef } from 'react';
import { renderPet, type Animal, type Dance } from './petRenderer';
import { DanceEngine, type Mode } from './engine';
import { createAnimationScheduler } from './animationScheduler';

export interface PetCanvasProps {
  animal: Animal; dance: Dance; mode: Mode; reducedMotion?: boolean;
  autoPlay?: boolean; inputCount?: number; petting?: number; className?: string;
  sensitivity?: number; paused?: boolean; easterEggs?: boolean;
  /** Desktop pets can remain visible even when the WebView reports hidden. */
  runInBackground?: boolean;
}

export default function PetCanvas(props: PetCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef(new DanceEngine());
  const latest = useRef(props);
  const previousCount = useRef(props.inputCount ?? 0);
  const previousPetting = useRef(props.petting ?? 0);
  const petUntil = useRef(0);
  const requestPaint = useRef<() => void>(() => {});
  latest.current = props;

  useEffect(() => { engine.current.reset(); }, [props.autoPlay]);
  useEffect(() => { engine.current.configure(props.mode, props.sensitivity); }, [props.mode, props.sensitivity]);
  useEffect(() => {
    const value = props.inputCount ?? 0;
    const diff = value - previousCount.current;
    previousCount.current = value;
    if (diff > 0 && !props.paused) { engine.current.pulse(diff, performance.now()); requestPaint.current(); }
  }, [props.inputCount, props.paused]);
  useEffect(() => { if (props.paused) engine.current.reset(); requestPaint.current(); }, [props.paused]);
  useEffect(() => { requestPaint.current(); }, [props.animal, props.dance, props.autoPlay, props.reducedMotion, props.easterEggs, props.runInBackground]);
  useEffect(() => {
    if ((props.petting ?? 0) !== previousPetting.current) petUntil.current = performance.now() + 1600;
    previousPetting.current = props.petting ?? 0;
    requestPaint.current();
  }, [props.petting]);

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const context = el.getContext('2d'); if (!context) return;
    const paint = () => {
      const p = latest.current;
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * dpr); const height = Math.round(rect.height * dpr);
      if (el.width !== width || el.height !== height) { el.width = width; el.height = height; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      const now = performance.now();
      const motion = engine.current.sample(now, Boolean(p.autoPlay && !p.paused));
      el.dataset.motion = motion.state;
      el.dataset.frames = String(Number(el.dataset.frames ?? 0) + 1);
      if (motion.state === 'dancing' || motion.state === 'settling') {
        el.dataset.dancingFrames = String(Number(el.dataset.dancingFrames ?? 0) + 1);
      }
      if (p.easterEggs === false && (motion.state === 'idle' || motion.state === 'sleeping')) { motion.state = 'idle'; motion.phase = 0; }
      const petting = Math.max(0, (petUntil.current - now) / 1600);
      renderPet(context, rect.width, rect.height, {
        animal: p.animal, dance: p.dance, ...motion,
        reducedMotion: p.reducedMotion || p.paused,
        petting,
      });
      const active = motion.state === 'dancing' || motion.state === 'settling' || petting > 0;
      return active && !p.reducedMotion ? 33 : 125;
    };
    const scheduler = createAnimationScheduler({
      paint,
      isHidden: () => document.hidden,
      isPaused: () => Boolean(latest.current.paused),
      runInBackground: () => Boolean(latest.current.runInBackground),
    });
    const resume = () => scheduler.requestPaint();
    requestPaint.current = resume;
    const observer = new ResizeObserver(resume); observer.observe(el);
    document.addEventListener('visibilitychange', resume); resume();
    return () => { requestPaint.current = () => {}; scheduler.dispose(); observer.disconnect(); document.removeEventListener('visibilitychange', resume); };
  }, []);

  const label = {fox:'狐狸',emojiFox:'表情小狐狸',girl:'紫瞳女孩',cat:'猫咪',capybara:'水豚'}[props.animal];
  return <canvas ref={canvas} className={props.className ?? 'pet-canvas'} role="img" aria-label={`${label}舞蹈预览`} />;
}
