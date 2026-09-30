import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ExternalLink, X } from 'lucide-react';
import { invoke, isTauri, listen } from './bridge';
import { updateProgress, updateStatusText, type UpdateState } from './updates';

export default function UpdatePanel({ visible, automatic, previews, disabled, onAutomaticChange, onPreviewsChange }: {
  visible: boolean; automatic: boolean; previews: boolean; disabled: boolean;
  onAutomaticChange: (value: boolean) => void; onPreviewsChange: (value: boolean) => void;
}) {
  const native = isTauri();
  const [state, setState] = useState<UpdateState>({ revision: 0, phase: 'idle', currentVersion: __APP_VERSION__, notes: '', downloaded: 0, canInstall: false, prompt: false });
  const [error, setError] = useState('');
  const alive = useRef(true);
  const operation = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = ['checking', 'downloading', 'installing'].includes(state.phase);
  const installing = state.phase === 'downloading' || state.phase === 'installing';
  const progress = updateProgress(state);

  useEffect(() => {
    alive.current = true;
    if (!native) return;
    let off: (() => void) | undefined;
    void (async () => {
      const unlisten = await listen<UpdateState>('foxbeat://update', event => {
        if (alive.current) setState(previous => event.payload.revision >= previous.revision ? event.payload : previous);
      });
      if (!alive.current) { unlisten(); return; }
      off = unlisten;
      const next = await invoke<UpdateState>('get_update_state');
      if (alive.current) setState(previous => next.revision >= previous.revision ? next : previous);
    })().catch(() => { if (alive.current) setError('无法读取更新状态，请重试。'); });
    return () => { alive.current = false; off?.(); };
  }, [native]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (state.prompt && !el.open) el.showModal();
    else if (!state.prompt && el.open) el.close();
  }, [state.prompt]);

  const command = async (name: string) => {
    if (operation.current) return;
    operation.current = true;
    setError('');
    try {
      const next = await invoke<UpdateState | undefined>(name);
      if (alive.current && next) setState(previous => next.revision >= previous.revision ? next : previous);
    } catch (reason) {
      if (alive.current) setError(typeof reason === 'string' ? reason : '更新操作未完成，请重试。');
    } finally { operation.current = false; }
  };

  const action = <button className="button button-primary" disabled={active || !native} onClick={() => void command(state.canInstall ? 'install_update' : 'open_update_release')}><Download size={16} />{installing ? '正在更新…' : state.canInstall ? state.phase === 'error' ? '重试更新' : '更新并重启' : '下载安装包'}</button>;
  const feedback = <>
    <p className="update-status" role="status" aria-live="polite">{native ? updateStatusText(state) : '在线更新仅在桌面客户端中可用'}</p>
    {installing && <div className="update-download"><progress max={100} value={progress.percent ?? undefined} aria-label="更新下载进度" /><span>{state.phase === 'installing' ? '正在安装…' : progress.label}</span></div>}
    {(state.error || error) && <p className="update-error" role="alert">{error || state.error}</p>}
  </>;

  return <>
    <section className="update-settings" aria-label="版本更新" hidden={!visible}>
      <div className="update-heading"><div><h2>版本更新</h2><p>FoxBeat {state.currentVersion}</p></div><button className="button button-outline" disabled={!native || active || disabled} onClick={() => void command('check_for_updates')}><RefreshCw size={16} className={state.phase === 'checking' ? 'update-spinning' : ''} />{state.phase === 'checking' ? '正在检查…' : '检查更新'}</button></div>
      <label className="toggle-row"><span className="toggle-copy"><span className="setting-label">自动检查更新</span></span><input type="checkbox" className="switch-input" checked={automatic} disabled={!native || disabled} onChange={e => onAutomaticChange(e.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span></label>
      <label className="toggle-row"><span className="toggle-copy"><span className="setting-label">接收开发预览版</span></span><input type="checkbox" className="switch-input" checked={previews} disabled={!native || disabled || active} onChange={e => onPreviewsChange(e.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span></label>
      {feedback}
      {state.availableVersion && !installing && <div className="update-actions">{action}<button className="text-button" disabled={active} onClick={() => void command('open_update_release')}><ExternalLink size={14} />发布详情</button></div>}
    </section>
    <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onCancel={event => { event.preventDefault(); if (!active) void command('dismiss_update'); }}>
      <div className="update-dialog-heading"><h2 id="update-title">{installing ? '正在更新狐伴' : `发现新版本 ${state.availableVersion ?? ''}`}</h2><button className="update-close" title="稍后提醒" aria-label="稍后提醒" disabled={active} onClick={() => void command('dismiss_update')}><X size={20} /></button></div>
      <p className="update-version">{state.currentVersion} → {state.availableVersion}</p>
      {!installing && state.notes && <div className="update-notes">{state.notes}</div>}
      {feedback}
      <div className="update-actions">{action}<button className="button button-outline" disabled={active} onClick={() => void command('dismiss_update')}>稍后提醒</button><button className="text-button" disabled={active} onClick={() => void command('open_update_release')}><ExternalLink size={14} />发布详情</button>{state.phase === 'error' && !state.canInstall && <button className="text-button" onClick={() => void command('check_for_updates')}>重试</button>}</div>
    </dialog>
  </>;
}
