import type { Animal, Dance } from './petRenderer';

export type { Animal, Dance } from './petRenderer';
export type DanceMode = 'continuous' | 'step';

export interface Settings {
  animal: Animal;
  dance: Dance;
  mode: DanceMode;
  keyboard: boolean;
  mouseClick: boolean;
  mouseScroll: boolean;
  allKeys: boolean;
  size: number;
  opacity: number;
  sensitivity: number;
  reducedMotion: boolean;
  autostart: boolean;
  easterEggs: boolean;
}

export interface InputStatus {
  state: string;
  message: string;
}

export interface AppState {
  settings: Settings;
  status: InputStatus;
  adjusting: boolean;
  paused: boolean;
  hidden: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  animal: 'fox',
  dance: 'sway',
  mode: 'continuous',
  keyboard: true,
  mouseClick: false,
  mouseScroll: false,
  allKeys: false,
  size: 180,
  opacity: 1,
  sensitivity: 1,
  reducedMotion: false,
  autostart: false,
  easterEggs: true,
};
