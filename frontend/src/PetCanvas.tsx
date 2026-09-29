import { useEffect, useRef } from 'react';
import { renderPet, type Animal, type Dance } from './petRenderer';
import { DanceEngine, type Mode } from './engine';
import { createAnimationScheduler } from './animationScheduler';
import { SpeechDirector, type CompanionSpeechEvent } from './speech';

export interface PetCanvasProps {
  animal: Animal; dance: Dance; mode: Mode; reducedMotion?: boolean;
  autoPlay?: boolean; inputCount?: number; petting?: number; className?: string;
  sensitivity?: number; paused?: boolean; easterEggs?: boolean;
  speechEnabled?: boolean; onSpeech?: (text: string) => void;
  /** Desktop pets can remain visible even when the WebView reports hidden. */
  runInBackground?: boolean;
}

export default function PetCanvas(props: PetCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef(new DanceEngine());
  const speech = useRef(new SpeechDirector());
  const speechTimer = useRef<number | undefined>(undefined);
  const latest = useRef(props);
  const previousCount = useRef(props.inputCount ?? 0);
  const previousPetting = useRef(props.petting ?? 0);
  const petUntil = useRef(0);
  const lastMotionState = useRef<string>('idle');
  const initialAnimal = useRef(props.animal);
  const previousAutoPlay = useRef(props.autoPlay);
  const requestPaint = useRef<() => void>(() => {});
  latest.current = props;

  const showSpeech = (event: CompanionSpeechEvent, now: number) => {
    const p = latest.current;
    const text = speech.current.trigger(p.animal, event, now, p.speechEnabled !== false);
    if (!text || !p.onSpeech) return;
    if (speechTimer.current !== undefined) window.clearTimeout(speechTimer.current);
    p.onSpeech(text);
    speechTimer.current = window.setTimeout(() => latest.current.onSpeech?.(''), 3200);
  };

  useEffect(() => {
    const now = performance.now();
    engine.current.reset();
    engine.current.event({ type: 'click', now });
    speech.current.reset();
    showSpeech('launch', now);
    return () => { if (speechTimer.current !== undefined) window.clearTimeout(speechTimer.current); };
    // The visual mount should greet once; animal changes have their own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (previousAutoPlay.current === props.autoPlay) return;
    previousAutoPlay.current = props.autoPlay;
    engine.current.reset();
    requestPaint.current();
  }, [props.autoPlay]);
  useEffect(() => { engine.current.configure(props.mode, props.sensitivity); }, [props.mode, props.sensitivity]);
  useEffect(() => {
    const value = props.inputCount ?? 0;
    const diff = value - previousCount.current;
    const wasFirst = previousCount.current === 0;
    previousCount.current = value;
    if (diff > 0 && !props.paused) {
      const now = performance.now();
      engine.current.event({ type: 'pulse', count: diff, now, source: 'preview' });
      showSpeech(diff >= 3 ? 'burst' : wasFirst ? 'first-input' : 'surprise', now);
      requestPaint.current();
    }
  }, [props.inputCount, props.paused]);
  useEffect(() => {
    if (props.paused) {
      showSpeech('pause', performance.now());
      engine.current.reset();
    }
    requestPaint.current();
  }, [props.paused]);
  useEffect(() => { requestPaint.current(); }, [props.animal, props.dance, props.autoPlay, props.reducedMotion, props.easterEggs, props.runInBackground]);
  useEffect(() => {
    if ((props.petting ?? 0) !== previousPetting.current) petUntil.current = performance.now() + 1600;
    if ((props.petting ?? 0) !== previousPetting.current) {
      const now = performance.now();
      engine.current.event({ type: 'pet', now });
      showSpeech('pet', now);
    }
    previousPetting.current = props.petting ?? 0;
    requestPaint.current();
  }, [props.petting]);

  useEffect(() => {
    if (initialAnimal.current === props.animal) return;
    initialAnimal.current = props.animal;
    const now = performance.now();
    engine.current.event({ type: 'click', now });
    showSpeech('theme-change', now);
    requestPaint.current();
  }, [props.animal]);

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
      if (motion.speech) {
        const event: CompanionSpeechEvent = motion.speech.kind === 'sleep' ? 'long-idle'
          : motion.speech.kind === 'pet' ? 'pet'
            : motion.speech.kind === 'click' ? 'surprise' : 'burst';
        showSpeech(event, motion.speech.at);
      }
      if (lastMotionState.current !== 'sleeping' && motion.state === 'sleeping') showSpeech('long-idle', now);
      lastMotionState.current = motion.state;
      el.dataset.motion = motion.state;
      el.dataset.frames = String(Number(el.dataset.frames ?? 0) + 1);
      if (motion.state === 'dancing' || motion.state === 'settling') {
        el.dataset.dancingFrames = String(Number(el.dataset.dancingFrames ?? 0) + 1);
      }
      if (p.easterEggs === false && (motion.state === 'idle' || motion.state === 'sleeping')) {
        motion.state = 'idle';
        motion.behavior = 'idle';
        motion.clip = 'idle';
        motion.clipElapsedMs = 0;
        motion.clipProgress = 0;
        motion.phase = 0;
      }
      const petting = Math.max(0, (petUntil.current - now) / 1600);
      renderPet(context, rect.width, rect.height, {
        animal: p.animal, dance: p.dance, ...motion,
        reducedMotion: p.reducedMotion || p.paused,
        petting,
      });
      const active = motion.state === 'dancing' || motion.state === 'settling' || petting > 0;
      // Reduced motion changes the pose amplitude, not the frame cadence.
      // Dropping to 8 fps here skips the in-between drawings in bitmap clips.
      return active ? 33 : p.animal === 'orangeFox' ? 50 : 125;
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
    const onVisibility = () => {
      if (!document.hidden) {
        const now = performance.now();
        engine.current.event({ type: 'click', now });
        showSpeech('launch', now);
      }
      resume();
    };
    document.addEventListener('visibilitychange', onVisibility); resume();
    return () => { requestPaint.current = () => {}; scheduler.dispose(); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const label = {
    fox: '狐狸', emojiFox: '表情小狐狸', girl: '紫瞳女孩', cat: '猫咪', capybara: '水豚',
    shyFox: '委屈小狐狸', yuexinCat: '月薪喵', orangeFox: '害羞橙狐',
  }[props.animal];
  return <canvas ref={canvas} className={props.className ?? 'pet-canvas'} role="img" aria-label={`${label}舞蹈预览`} />;
}
