import { invoke as nativeInvoke, isTauri as nativeIsTauri } from '@tauri-apps/api/core';
import { listen as nativeListen } from '@tauri-apps/api/event';
import { DEFAULT_SETTINGS, type AppState, type Settings } from './types';

export const isTauri = nativeIsTauri;
type Event<T> = { payload: T };
type Handler = (event: Event<unknown>) => void;
const listeners = new Map<string, Set<Handler>>();
let preview: AppState = {
  settings: {...DEFAULT_SETTINGS},
  status: {state:'preview', message:'浏览器试玩 · 仅响应下方试打区域，不监听其他应用'},
  adjusting:false,paused:false,hidden:false,
};

function emit(name: string, payload: unknown) {
  listeners.get(name)?.forEach(callback => callback({payload:structuredClone(payload)}));
}

/** Browser fallback exists only for a clearly labelled, entirely local UI preview. */
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) return nativeInvoke<T>(command,args);
  switch(command) {
    case 'get_state': break;
    case 'apply_theme': preview.settings = {...preview.settings,animal:args.animal as Settings['animal'],dance:args.dance as Settings['dance']};break;
    case 'update_settings': {
      const next = args.settings as Settings;
      if(next.autostart !== preview.settings.autostart) throw new Error('登录启动只能在桌面客户端中设置。');
      preview.settings = {...next};break;
    }
    case 'set_adjusting': case 'reset_pet': throw new Error('浏览器只能预览角色；请在桌面客户端中移动桌面小舞伴。');
    case 'set_paused': preview.paused = Boolean(args.value);preview.hidden = Boolean(args.value);break;
    case 'retry_input': case 'main_ready': case 'pet_ready': break;
    case 'open_input_settings': throw new Error('请在桌面客户端中打开系统输入权限设置。');
    case 'quit_app': throw new Error('这是浏览器试玩，可直接关闭此标签页。');
    default: throw new Error(`未支持的操作：${command}`);
  }
  if (command!=='get_state') emit('foxbeat://state',preview);
  return structuredClone(preview) as T;
}

export async function listen<T>(name: string, callback:(event:Event<T>)=>void): Promise<()=>void> {
  if (isTauri()) return nativeListen<T>(name,callback);
  const set=listeners.get(name) ?? new Set<Handler>();listeners.set(name,set);
  const handler=callback as Handler;set.add(handler);
  return ()=>{set.delete(handler);};
}
