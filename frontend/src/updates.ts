export interface UpdateState {
  revision: number;
  phase: string;
  currentVersion: string;
  availableVersion?: string | null;
  notes: string;
  downloaded: number;
  total?: number | null;
  error?: string | null;
  canInstall: boolean;
  prompt: boolean;
}

export function updateProgress(state: Pick<UpdateState, 'downloaded' | 'total'>) {
  const downloaded = Number.isFinite(state.downloaded) ? Math.max(0, state.downloaded) : 0;
  const total = state.total && Number.isFinite(state.total) && state.total > 0 ? state.total : undefined;
  const percent = total ? Math.min(100, Math.round(downloaded / total * 100)) : undefined;
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return { percent, label: total ? `${percent}% · ${mb(downloaded)} / ${mb(total)}` : `已下载 ${mb(downloaded)}` };
}

export function updateStatusText(state: UpdateState): string {
  switch (state.phase) {
    case 'checking': return '正在检查新版本…';
    case 'current': return '当前已是最新版本';
    case 'available': return `可更新到 ${state.availableVersion}`;
    case 'downloading': return '正在下载并校验更新包…';
    case 'installing': return '安装完成后将重新启动';
    case 'error': return '更新未完成';
    default: return '尚未检查更新';
  }
}
