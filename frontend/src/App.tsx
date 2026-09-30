import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke, isTauri, listen } from './bridge';
import PetCanvas from './PetCanvas';
import { isPreviewPulseKey } from './previewInput';
import { DEFAULT_SETTINGS } from './types';
import type { Animal, AppState, Dance, InputStatus, Settings } from './types';
import './styles.css';

type IconName = 'paw' | 'grid' | 'settings' | 'check' | 'arrow' | 'play' | 'pause' | 'move' | 'keyboard' | 'mouse' | 'scroll' | 'leaf' | 'close' | 'reset';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    paw: <><ellipse cx="7" cy="7" rx="2" ry="3" transform="rotate(-25 7 7)" /><ellipse cx="17" cy="7" rx="2" ry="3" transform="rotate(25 17 7)" /><ellipse cx="3.8" cy="12" rx="1.7" ry="2.4" transform="rotate(-28 3.8 12)" /><ellipse cx="20.2" cy="12" rx="1.7" ry="2.4" transform="rotate(28 20.2 12)" /><path d="M6 18c0-3 3.6-7 6-7s6 4 6 7c0 3-3 2-6 2s-6 1-6-2Z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    settings: <><path d="M9.5 3h5l.8 3 2.7 1 2.5 2.5-1.5 2.7.2 3.3-3 1-1.7 2.8h-5L8.8 17 6 16l-2.5-2.5L5 10.8 4.8 7.5l3-1Z" /><circle cx="12" cy="11" r="3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    move: <><path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" /></>,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h.1m3.9 0h.1m3.9 0h.1m3.9 0h.1M6 12h.1m3.9 0h.1m3.9 0h.1m3.9 0h.1M7 16h10" /></>,
    mouse: <><rect x="6" y="2" width="12" height="20" rx="6" /><path d="M12 2v7M6 10h12" /></>,
    scroll: <><rect x="6" y="2" width="12" height="20" rx="6" /><path d="M12 6v5m-2-3 2-2 2 2" /></>,
    leaf: <><path d="M20 3C8 1 2 8 5 15s16 6 15-12Z" /><path d="M3 21 15 9" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const animals: { id: Animal; name: string; note: string; color: string }[] = [
  { id: 'girl', name: '紫瞳女孩', note: '挥挥手，陪你小雀跃', color: 'girl' },
  { id: 'emojiFox', name: '表情小狐狸', note: '大耳朵，藏不住开心', color: 'emojiFox' },
  { id: 'shyFox', name: '委屈小狐狸', note: '皱皱眉，也要陪你跳', color: 'shyFox' },
  { id: 'fox', name: '小狐狸', note: '灵动，是我的本能', color: 'fox' },
  { id: 'cat', name: '小猫咪', note: '偶尔傲娇，一直陪伴', color: 'cat' },
  { id: 'yuexinCat', name: '月薪喵', note: '捂捂脸，今天也要上班', color: 'yuexinCat' },
  { id: 'orangeFox', name: '害羞橙狐', note: '捂嘴偷看，尾巴也会害羞', color: 'orangeFox' },
  { id: 'capybara', name: '水豚', note: '慢一点，也很好', color: 'capybara' },
];
const dances: { id: Dance; name: string; note: string; number: string }[] = [
  { id: 'sway', name: '左右摇摆', note: '晃一晃，心情就轻了', number: '01' },
  { id: 'step', name: '踏步扭扭', note: '小碎步，跟上你的节奏', number: '02' },
  { id: 'wave', name: '挥爪欢跳', note: '把开心举得高一点', number: '03' },
];

const initialState: AppState = {
  settings: DEFAULT_SETTINGS,
  status: { state: 'starting', message: '正在准备小舞伴…' },
  adjusting: false, paused: false, hidden: false,
};
const isReady = (status: InputStatus) => status.state === 'listening';
const messageOf = (error: unknown) => error instanceof Error ? error.message : typeof error === 'string' ? error : '操作暂时没有完成，请再试一次。';

function Toggle({ label, note, checked, onChange, disabled = false, icon }: {
  label: string; note?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; icon?: IconName;
}) {
  return <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
    {icon && <span className="setting-icon"><Icon name={icon} /></span>}
    <span className="toggle-copy"><span className="setting-label">{label}</span>{note && <span className="setting-note">{note}</span>}</span>
    <input type="checkbox" className="switch-input" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} />
    <span className="switch-track" aria-hidden="true"><span /></span>
  </label>;
}

function RangeControl({ label, valueLabel, min, max, step, value, onChange, disabled }: {
  label: string; valueLabel: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void; disabled: boolean;
}) {
  return <label className="range-control"><span className="range-label"><span>{label}</span><output>{valueLabel}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} disabled={disabled} />
  </label>;
}

export default function App() {
  const [page, setPage] = useState<'themes' | 'settings'>('themes');
  const [app, setApp] = useState<AppState>(initialState);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState({ animal: DEFAULT_SETTINGS.animal, dance: DEFAULT_SETTINGS.dance });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [previewListening, setPreviewListening] = useState(false);
  const [inputCount, setInputCount] = useState(0);
  const [hasTried, setHasTried] = useState(false);
  const [petting, setPetting] = useState(0);
  const [whipCount, setWhipCount] = useState(0);
  const [hardWhipCount, setHardWhipCount] = useState(0);
  const [speech, setSpeech] = useState('');
  const tryRef = useRef<HTMLButtonElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<AppState>(initialState);
  const draftRef = useRef(draft);
  const settingsRef = useRef(settings);
  const initialized = useRef(false);
  const draftEdited = useRef(false);
  const busyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingSettings = useRef<Settings | null>(null);
  const alive = useRef(true);
  const native = isTauri();

  const receiveState = useCallback((next: AppState) => {
    if (!alive.current) return;
    const previous = stateRef.current.settings;
    const stillApplied = draftRef.current.animal === previous.animal && draftRef.current.dance === previous.dance;
    stateRef.current = next;
    setApp(next);
    if (!savingRef.current) {
      settingsRef.current = next.settings;
      setSettings(next.settings);
    }
    if ((!initialized.current && !draftEdited.current) || (initialized.current && stillApplied)) {
      const nextDraft = { animal: next.settings.animal, dance: next.settings.dance };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
    initialized.current = true;
    setLoaded(true);
  }, []);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    const register = async () => {
      try {
        const offState = await listen<AppState>('foxbeat://state', (event: { payload: AppState }) => { if (!cancelled) receiveState(event.payload); });
        if (cancelled) { offState(); return; }
        unlisteners.push(offState);
        const offStatus = await listen<InputStatus>('foxbeat://input-status', (event: { payload: InputStatus }) => {
          if (!cancelled) receiveState({ ...stateRef.current, status: event.payload });
        });
        if (cancelled) { offStatus(); return; }
        unlisteners.push(offStatus);
      } catch (reason) { if (!cancelled) setError(messageOf(reason)); }
      if (cancelled) return;
      try {
        const value = await invoke<AppState>('get_state');
        if (!cancelled) receiveState(value);
      } catch (reason) {
        if (!cancelled) { setError(messageOf(reason)); setLoaded(true); }
      }
    };
    void register();
    return () => { cancelled = true; alive.current = false; unlisteners.forEach(unlisten => unlisten()); };
  }, [receiveState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const changeDraft = (patch: Partial<typeof draft>) => {
    draftEdited.current = true;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setNotice('');
  };

  const flushSettings = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    while (pendingSettings.current) {
      const next = pendingSettings.current;
      pendingSettings.current = null;
      try {
        const result = await invoke<AppState>('update_settings', { settings: next });
        if (!alive.current) break;
        receiveState(result);
      } catch (reason) {
        if (alive.current) setError(`设置未保存：${messageOf(reason)}`);
        pendingSettings.current = null;
        break;
      }
    }
    savingRef.current = false;
    if (alive.current) {
      settingsRef.current = stateRef.current.settings;
      setSettings(stateRef.current.settings);
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (busyRef.current || (!native && key === 'autostart')) return;
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    pendingSettings.current = next;
    void flushSettings();
  };

  const command = async (name: string, args: Record<string, unknown> = {}, success = '') => {
    if (busyRef.current || savingRef.current) return;
    if (!native && ['set_adjusting', 'reset_pet', 'set_paused'].includes(name)) return;
    busyRef.current = true;
    setBusy(name);
    setError('');
    try {
      const result = await invoke<AppState | null>(name, args);
      if (result?.settings) receiveState(result);
      if (success) setNotice(success);
    } catch (reason) { setError(messageOf(reason)); }
    finally { busyRef.current = false; setBusy(''); }
  };

  const applyTheme = async () => {
    if (busyRef.current || savingRef.current || !loaded) return;
    const selection = { ...draftRef.current };
    busyRef.current = true;
    setBusy('apply_theme');
    setError('');
    try {
      const result = await invoke<AppState>('apply_theme', selection);
      if (!result?.settings || result.settings.animal !== selection.animal || result.settings.dance !== selection.dance) {
        throw new Error('主题应用结果与所选组合不同，请重新应用。');
      }
      receiveState(result);
      const selectedAnimal = animals.find(item => item.id === result.settings.animal)!;
      const selectedDance = dances.find(item => item.id === result.settings.dance)!;
      setNotice(`${native ? '桌面已换成' : '本次预览已选择'}${selectedAnimal.name} · ${selectedDance.name}`);
    } catch (reason) { setError(messageOf(reason)); }
    finally { busyRef.current = false; setBusy(''); }
  };

  const pulsePreview = useCallback((fromKeyboard = false) => {
    setAutoPlay(false);
    setHasTried(true);
    setInputCount(count => count + 1);
    if (native) {
      void invoke('preview_pulse', { fromKeyboard }).catch(reason => {
        if (alive.current) setError(`桌面试跳未完成：${messageOf(reason)}`);
      });
    }
  }, [native]);

  const enterTrial = () => {
    setAutoPlay(false);
    setPreviewListening(true);
    pulsePreview();
    requestAnimationFrame(() => {
      interactionRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  useEffect(() => {
    if (page !== 'themes' || !previewListening || autoPlay) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isPreviewPulseKey({
        key: event.key,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        altGraph: event.getModifierState('AltGraph'),
        isComposing: event.isComposing,
        editable: Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')),
        button: Boolean(target?.closest('button, [role="button"], a[href]')),
      })) return;
      event.preventDefault();
      pulsePreview(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, previewListening, autoPlay, pulsePreview]);

  const animal = animals.find(item => item.id === draft.animal)!;
  const dance = dances.find(item => item.id === draft.dance)!;
  const dirty = draft.animal !== app.settings.animal || draft.dance !== app.settings.dance;
  const controlsDisabled = !loaded || Boolean(busy);
  const commandDisabled = controlsDisabled || saving;
  const ready = isReady(app.status);
  const starting = ['ready', 'starting'].includes(app.status.state);
  const needsPermission = ['permission_required', 'denied'].includes(app.status.state);
  const sourcesOff = !settings.keyboard && !settings.mouseClick && !settings.mouseScroll;
  const manualOnly = ['disabled', 'manual', 'preview'].includes(app.status.state) && !sourcesOff;
  const statusLabel = !native ? '浏览器预览' : app.adjusting ? '正在调整位置' : app.hidden ? '小舞伴已隐藏' : app.paused ? '陪伴已暂停' : sourcesOff ? '输入跟随已关闭' : manualOnly ? '手动试玩模式' : ready ? '跨应用跟随已开启' : needsPermission ? '仅本窗口试打 · 待授权' : starting ? '正在准备' : '手动试玩可用';
  const inputHeading = !native ? '这是浏览器试玩，桌面功能请打开客户端' : sourcesOff ? '输入跟随已关闭' : manualOnly ? '当前为手动试玩模式' : starting ? '小舞伴正在准备听见节奏' : needsPermission ? '后台打字跟随尚未开启：需要输入监控权限' : '开启打字跟随，让陪伴走出这个窗口';
  const inputNote = !native ? '点击试打区域，再敲键。这里可以换主题、调整预览大小；跨应用跟随和桌面拖动需要桌面客户端。' : sourcesOff ? '打开至少一种输入来源，才会跟随其他应用中的操作。当前窗口试打仍可让预览和桌面小舞伴回应。' : manualOnly ? `${app.status.message || '本次启动没有开启全局输入监听。'} 当前窗口试打仍可让预览和桌面小舞伴回应；跨应用跟随需正常启动客户端。` : app.status.message || '只感知敲键节奏，不读取或保存文字。当前窗口试打无需系统权限，也能让桌面小舞伴回应。';
  const trialScope = !native ? '上方预览跟随当前窗口按键，不需要系统权限' : app.paused || app.hidden ? '当前窗口预览可试打；桌面小舞伴已暂停或隐藏，请先恢复陪伴' : needsPermission ? '仅本窗口试打可用；切换到其他软件后跟随，需要先允许输入监控' : '当前窗口试打：预览和桌面宠物都会回应，无需系统权限';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="paw" size={26} /></span><div><strong>狐伴</strong><span>FoxBeat</span></div></div>
      <div className="sidebar-caption">把日常，跳成小快乐</div>
      <nav className="primary-nav" aria-label="主导航">
        <button className={page === 'themes' ? 'nav-button active' : 'nav-button'} onClick={() => setPage('themes')} aria-label="主题中心" title="主题中心" aria-current={page === 'themes' ? 'page' : undefined}><Icon name="grid" /><span>主题中心</span><span className="nav-dot" /></button>
        <button className={page === 'settings' ? 'nav-button active' : 'nav-button'} onClick={() => setPage('settings')} aria-label="偏好设置" title="偏好设置" aria-current={page === 'settings' ? 'page' : undefined}><Icon name="settings" /><span>偏好设置</span><span className="nav-dot" /></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="companion-status"><span className={`status-dot${ready && !app.paused && !app.hidden ? ' live' : ''}`} /><span>{statusLabel}</span></div>
        <button className="sidebar-action" title={native ? undefined : '请在桌面客户端中使用'} disabled={commandDisabled || !native} onClick={() => void command('set_paused', { value: !app.paused })}><Icon name={app.paused ? 'play' : 'pause'} size={16} />{app.paused ? '继续陪伴' : '暂停陪伴'}</button>
        <button className="sidebar-action" title={native ? undefined : '请在桌面客户端中使用'} disabled={commandDisabled || !native} onClick={() => void command('reset_pet', {}, '小舞伴已回到主屏幕。')}><Icon name="reset" size={16} />找回小舞伴</button>
        <div className="offline-note"><Icon name="leaf" size={14} /> 离线运行 · 不保存输入</div>
      </div>
    </aside>

    <main className="main-content">
      <header className="page-header"><div><div className="eyebrow">YOUR LITTLE DESKTOP COMPANION</div><h1>{page === 'themes' ? '今天，谁陪你跳舞？' : '舒服的节奏，你来定'}</h1><p>{page === 'themes' ? '挑一位小舞伴，让每一次敲键都多一点开心。' : '轻轻调整，让小舞伴融入你的日常。'}</p></div><div className="header-actions"><span className="local-badge"><span />{native ? '本地陪伴' : '浏览器试玩'}</span>{native && <button className="button button-outline" disabled={commandDisabled || !native} title={native ? undefined : '请在桌面客户端中使用'} onClick={() => void command('set_adjusting', { value: !app.adjusting }, app.adjusting ? '位置已记住，仍可直接点击或拖动舞伴。' : '现在可以拖动桌面小舞伴，结束后点击完成调整。')}><Icon name={app.adjusting ? 'check' : 'move'} size={16} />{app.adjusting ? '完成调整' : '调整桌面位置'}</button>}</div></header>

      {error && <div className="feedback error-message" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={17} /></button></div>}
      {notice && <div className="feedback success-message" role="status"><Icon name="check" size={17} /><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={17} /></button></div>}

      {loaded && (!ready || sourcesOff) && <section className={`permission-card ${!native || app.status.state === 'disabled' ? 'preview-notice' : ''}`} aria-label="输入跟随状态">
        <span className="permission-icon"><Icon name="keyboard" size={23} /></span>
        <div><strong>{inputHeading}</strong><p>{inputNote}</p></div>
        {native && sourcesOff ? <div className="permission-actions"><button className="button button-small button-soft" onClick={() => setPage('settings')}>选择输入来源</button></div> : native && !manualOnly && <div className="permission-actions"><button className="button button-small button-soft" disabled={commandDisabled || starting} onClick={() => void command('retry_input', { requestPermission: true })}>{starting ? '正在准备…' : busy === 'retry_input' ? '正在检查…' : '开启打字跟随'}</button>{needsPermission && <button className="text-button" disabled={commandDisabled} onClick={() => void command('open_input_settings')}>打开系统设置</button>}</div>}
      </section>}

      {page === 'themes' ? <div className="theme-layout">
        <section className="selection-panel" aria-label="主题选择">
          <div className="section-heading"><div><span className="section-number">01</span><h2>选一位小舞伴</h2></div><span className="section-aside">{animals.length} 位，随心切换</span></div>
          <div className="animal-grid">{animals.map(item => <button key={item.id} className={`animal-card animal-${item.color}${draft.animal === item.id ? ' selected' : ''}`} aria-pressed={draft.animal === item.id} onClick={() => changeDraft({ animal: item.id })} disabled={Boolean(busy)}>
            <span className="selected-check"><Icon name="check" size={13} /></span>
            <span className="animal-portrait"><PetCanvas animal={item.id} dance="sway" mode="continuous" autoPlay={false} reducedMotion className="portrait-canvas" /></span>
            <strong>{item.name}</strong><span className="animal-note">{item.note}</span>
          </button>)}</div>

          <div className="section-heading dance-heading"><div><span className="section-number">02</span><h2>再挑一支舞</h2></div><span className="section-aside">都有自己的小性格</span></div>
          <div className="dance-list">{dances.map(item => <button key={item.id} className={`dance-card${draft.dance === item.id ? ' selected' : ''}`} aria-pressed={draft.dance === item.id} onClick={() => changeDraft({ dance: item.id })} disabled={Boolean(busy)}>
            <span className={`dance-symbol dance-symbol-${item.id}`} aria-hidden="true"><i /><i /><i /></span>
            <span className="dance-copy"><strong>{item.name}</strong><span>{item.note}</span></span><span className="dance-number">{item.number}</span><span className="dance-radio"><span /></span>
          </button>)}</div>

          <div className="small-kindness"><span className="kindness-leaf"><Icon name="leaf" size={21} /></span><div><strong>停下来，也一样可爱</strong><p>你认真打字，它认真跳舞。你想歇会儿，它也陪你发会儿呆。</p></div></div>
        </section>

        <section className="preview-panel" aria-label="舞伴实时预览">
          <div className="preview-heading"><span className="preview-label"><span />LIVE PREVIEW</span><span className="preview-mode-label">{settings.mode === 'continuous' ? '连续舞蹈' : '原味逐帧'}</span></div>
          <div className="preview-interaction" ref={interactionRef}>
            <div className="preview-switch" role="group" aria-label="预览方式">
              <button className={autoPlay ? 'active' : ''} aria-pressed={autoPlay} onClick={() => { setPreviewListening(false); setAutoPlay(true); }}><Icon name="play" size={15} />完整舞蹈</button>
              <button className={previewListening && !autoPlay ? 'active' : ''} aria-pressed={previewListening && !autoPlay} onClick={() => { enterTrial(); tryRef.current?.focus({ preventScroll: true }); }}><Icon name="keyboard" size={16} />试打互动</button>
            </div>
            <div className={`pet-stage stage-${draft.animal}`}>
              <div className="stage-orbit orbit-one" /><div className="stage-orbit orbit-two" />
              <span className="stage-spark spark-one" /><span className="stage-spark spark-two" />
              <button className="stage-pet-button" aria-label={`摸摸${animal.name}`} onClick={() => setPetting(count => count + 1)}><span className="scaled-pet-preview" style={{ transform: `scale(${settings.size / 320})`, opacity: settings.opacity }}><PetCanvas animal={draft.animal} dance={draft.dance} mode={settings.mode} reducedMotion={settings.reducedMotion} autoPlay={autoPlay} inputCount={inputCount} petting={petting} whipCount={whipCount} hardWhipCount={hardWhipCount} sensitivity={settings.sensitivity} easterEggs={settings.easterEggs} speechEnabled={settings.speechEnabled} onSpeech={setSpeech} className="stage-pet-canvas" /></span></button>
              {speech && <span className="speech-bubble" role="status" aria-live="polite">{speech}</span>}
              <span className="stage-caption">{autoPlay ? '完整舞蹈自动播放中' : hasTried ? '你的节奏，我有听见' : '点击下方试打，和我一起跳'}</span>
            </div>
            <div className="preview-info"><h2>{animal.name}<span>·</span>{dance.name}</h2></div>
            {['fox', 'emojiFox', 'shyFox', 'orangeFox'].includes(draft.animal) && <div className="preview-whip-actions" role="group" aria-label="小鞭子互动"><button className="preview-whip-button" onClick={() => setWhipCount(count => count + 1)}>轻轻抽</button><button className="preview-whip-button strong" onClick={() => setHardWhipCount(count => count + 1)}>狠狠抽</button></div>}
            <button ref={tryRef} className={`try-pad${previewListening && !autoPlay ? ' engaged' : ''}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); enterTrial(); }} aria-label={native ? '开启当前窗口试打，让预览和桌面小舞伴回应' : '开启当前窗口试打，让上方预览跳舞'}>
              <span className="try-heading"><span className="try-keys"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><strong>{autoPlay ? '点击停止自动播放，开始试打' : previewListening ? '已就绪，在当前窗口随意敲键' : '点击这里，再敲键'}</strong></span>
              <span className="try-feedback" role="status"><span className={previewListening ? 'status-dot live' : 'status-dot'} />本次收到 {inputCount} 次互动</span>
              <span>{trialScope}</span>
            </button>
            {native && (app.paused || app.hidden) && <button className="text-button" disabled={commandDisabled} onClick={() => void command('set_paused', { value: false })}>恢复桌面小舞伴</button>}
          </div>
          <div className="preview-size-controls"><RangeControl label="大小预览" valueLabel={`${settings.size} px`} min={96} max={320} step={4} value={settings.size} onChange={value => updateSetting('size', value)} disabled={controlsDisabled} /><RangeControl label="不透明度" valueLabel={`${Math.round(settings.opacity * 100)}%`} min={0.3} max={1} step={0.05} value={settings.opacity} onChange={value => updateSetting('opacity', value)} disabled={controlsDisabled} /></div>
          <div className="apply-area"><button className="button button-primary" disabled={!dirty || commandDisabled} onClick={() => void applyTheme()}>{busy === 'apply_theme' ? <><span className="spinner" />正在切换…</> : dirty ? <>{native ? '应用到桌面' : '选作当前预览'}<Icon name="arrow" size={18} /></> : <><Icon name="check" size={18} />{native ? '已应用到桌面' : '当前预览组合'}</>}</button><p>{native ? dirty ? '现在是预览，应用后才更换桌面小舞伴' : '下次见面，也会记得这个选择' : '只更新本页试玩，不会创建或移动桌面宠物'}</p></div>
        </section>
      </div> : <div className="settings-page">
        <div className="settings-toolbar"><span><Icon name="settings" size={16} />偏好设置</span><span className={saving ? 'save-state saving' : 'save-state'} role="status">{saving ? <><span className="spinner" />正在保存…</> : <><Icon name="check" size={14} />{native ? '设置自动保存' : '仅本页试玩生效'}</>}</span></div>
        <section className="settings-card mode-settings"><div className="settings-card-heading"><h2>打字怎么跳</h2><p>两种玩法，同一份小快乐。</p></div><div className="mode-options">
          <button disabled={controlsDisabled} className={`mode-option${settings.mode === 'continuous' ? ' selected' : ''}`} aria-pressed={settings.mode === 'continuous'} onClick={() => updateSetting('mode', 'continuous')}><span className="mode-icon"><Icon name="play" /></span><span><strong>连续舞蹈 <em>推荐</em></strong><span>跟随节奏连贯跳舞，停下来后慢慢收势。</span></span><span className="dance-radio"><span /></span></button>
          <button disabled={controlsDisabled} className={`mode-option${settings.mode === 'step' ? ' selected' : ''}`} aria-pressed={settings.mode === 'step'} onClick={() => updateSetting('mode', 'step')}><span className="mode-icon"><Icon name="keyboard" /></span><span><strong>原味逐帧</strong><span>按一下，动作往前一步。节奏由你掌握。</span></span><span className="dance-radio"><span /></span></button>
        </div></section>
        <div className="settings-columns"><section className="settings-card"><div className="settings-card-heading"><h2>跟随哪些操作</h2><p>按自己的习惯，打开想要的回应。</p></div>
          <Toggle label="键盘输入" note="你打字，它跳舞" icon="keyboard" checked={settings.keyboard} onChange={value => updateSetting('keyboard', value)} disabled={controlsDisabled} />
          <Toggle label="鼠标点击" note="每次点击，也有回应" icon="mouse" checked={settings.mouseClick} onChange={value => updateSetting('mouseClick', value)} disabled={controlsDisabled} />
          <Toggle label="鼠标滚轮" note="浏览时，也能一起动一动" icon="scroll" checked={settings.mouseScroll} onChange={value => updateSetting('mouseScroll', value)} disabled={controlsDisabled} />
          {!settings.keyboard && !settings.mouseClick && !settings.mouseScroll && <p className="inline-hint">输入跟随已关闭，仍可在主题中心试玩。</p>}
          <div className="settings-divider" /><Toggle label="所有按键都响应" note="默认忽略修饰键和常见快捷键" checked={settings.allKeys} onChange={value => updateSetting('allKeys', value)} disabled={controlsDisabled} />
        </section><section className="settings-card"><div className="settings-card-heading"><h2>桌面上的小位置</h2><p>小一点陪伴，大一点开心。</p></div>
          <RangeControl label="小舞伴大小" valueLabel={`${settings.size} px`} min={96} max={320} step={4} value={settings.size} onChange={value => updateSetting('size', value)} disabled={controlsDisabled} />
          <RangeControl label="不透明度" valueLabel={`${Math.round(settings.opacity * 100)}%`} min={0.3} max={1} step={0.05} value={settings.opacity} onChange={value => updateSetting('opacity', value)} disabled={controlsDisabled} />
          <div className="position-actions"><button className="button button-outline" disabled={commandDisabled || !native} title={native ? undefined : '请在桌面客户端中使用'} onClick={() => void command('set_adjusting', { value: !app.adjusting }, app.adjusting ? '位置已记住，仍可直接点击或拖动舞伴。' : '现在可以拖动小舞伴，完成后请结束调整。')}><Icon name={app.adjusting ? 'check' : 'move'} size={16} />{app.adjusting ? '完成调整' : '调整位置'}</button><button className="button button-outline" disabled={commandDisabled || !native} title={native ? undefined : '请在桌面客户端中使用'} onClick={() => void command('reset_pet', {}, '小舞伴已回到主屏幕。')}><Icon name="reset" size={16} />找回小舞伴</button></div>
          <p className="field-note">{native ? '直接点击桌面舞伴即可互动，按住身体移动可拖动位置，无需输入监控权限。拖动后位置自动保存；调整模式提供额外拖柄。' : '浏览器只能调整预览画面；桌面拖动、找回与开机启动需要桌面客户端。'}</p>
        </section></div>
        <div className="settings-columns"><section className="settings-card"><div className="settings-card-heading"><h2>动作与心情</h2><p>热闹一点，或安静一点。</p></div>
          <RangeControl label="节奏灵敏度" valueLabel={settings.sensitivity < 0.8 ? '轻柔' : settings.sensitivity > 1.2 ? '活泼' : '标准'} min={0.5} max={1.5} step={0.1} value={settings.sensitivity} onChange={value => updateSetting('sensitivity', value)} disabled={controlsDisabled} />
          <Toggle label="减少动态效果" note="减小动作幅度，让陪伴更安静" checked={settings.reducedMotion} onChange={value => updateSetting('reducedMotion', value)} disabled={controlsDisabled} />
          <Toggle label="闲置小彩蛋" note="偶尔眨眼、伸懒腰，陪你发呆" checked={settings.easterEggs} onChange={value => updateSetting('easterEggs', value)} disabled={controlsDisabled} />
          <Toggle label="偶尔说句话" note="只根据互动节奏说短句，不读取输入内容" checked={settings.speechEnabled} onChange={value => updateSetting('speechEnabled', value)} disabled={controlsDisabled} />
        </section><section className="settings-card"><div className="settings-card-heading"><h2>每次见面</h2><p>需要的时候，我们再出现。</p></div>
          <Toggle label="登录电脑时启动" note={native ? '下次打开电脑，小舞伴自动来报到' : '仅桌面客户端支持，浏览器无法设置'} checked={settings.autostart} onChange={value => updateSetting('autostart', value)} disabled={controlsDisabled || !native} />
          <div className="settings-divider" /><div className="input-status-detail"><span className={`status-dot${ready ? ' live' : ''}`} /><div><strong>{!native ? '当前为浏览器预览' : sourcesOff ? '所有输入来源已关闭' : manualOnly ? '当前为手动试玩模式' : ready ? '输入跟随已就绪' : starting ? '正在启动输入跟随' : '输入跟随尚未就绪'}</strong><p>{app.status.message || '可以先在主题中心手动试玩。'}</p></div></div>
          {native && !manualOnly && !sourcesOff && <div className="permission-inline-actions"><button className="text-button" disabled={commandDisabled || starting} onClick={() => void command('retry_input', { requestPermission: true })}>重新检查</button>{needsPermission && <button className="text-button" disabled={commandDisabled} onClick={() => void command('open_input_settings')}>系统权限设置</button>}</div>}
        </section></div>
        <footer className="settings-footer"><Icon name="leaf" size={17} /><span>{native ? '没有账号，没有上传。主题和设置，都留在这台电脑上。' : '这是浏览器试玩。选择仅在本页生效，刷新后会恢复默认。'}</span></footer>
      </div>}
    </main>
  </div>;
}
