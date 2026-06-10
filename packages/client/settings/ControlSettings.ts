import { EventBus } from '../game/managers/EventBus';

export const MAX_KEYS_PER_DIRECTION = 5;
const STORAGE_KEY = 'tron0.controls';

export type TurnSide = 'left' | 'right';

export interface ControlSettings {
  version: 1;
  left: string[];
  right: string[];
}

export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  version: 1,
  left: ['q', 's', 'd', 'arrowleft'],
  right: ['k', 'l', 'm', 'arrowright'],
};

/** Normalize a KeyboardEvent.key value into a stable binding identifier. */
export function normalizeBindingKey(key: string): string {
  if (key.startsWith('Arrow')) return key.toLowerCase();
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

/** Human-readable label for a binding key in the settings UI. */
export function formatBindingLabel(key: string): string {
  if (key === 'arrowleft') return '←';
  if (key === 'arrowright') return '→';
  return key.toUpperCase();
}

/** Returns true when the key is allowed as a turn binding. */
export function isAllowedBindingKey(key: string): boolean {
  const normalized = normalizeBindingKey(key);
  if (normalized === 'arrowleft' || normalized === 'arrowright') return true;
  return normalized.length === 1 && normalized >= 'a' && normalized <= 'z';
}

function cloneSettings(settings: ControlSettings): ControlSettings {
  return { version: 1, left: [...settings.left], right: [...settings.right] };
}

function sanitizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const result: string[] = [];
  for (const entry of keys) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeBindingKey(entry);
    if (!isAllowedBindingKey(normalized)) continue;
    if (result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= MAX_KEYS_PER_DIRECTION) break;
  }
  return result;
}

function sanitizeSettings(raw: unknown): ControlSettings {
  const fallback = cloneSettings(DEFAULT_CONTROL_SETTINGS);
  if (!raw || typeof raw !== 'object') return fallback;

  const data = raw as Partial<ControlSettings>;
  const left = sanitizeKeys(data.left);
  const right = sanitizeKeys(data.right);

  const usedRight = new Set(right);
  const dedupedLeft = left.filter((key) => !usedRight.has(key));
  const usedLeft = new Set(dedupedLeft);
  const dedupedRight = right.filter((key) => !usedLeft.has(key));

  return {
    version: 1,
    left: dedupedLeft.length > 0 ? dedupedLeft : [...fallback.left],
    right: dedupedRight.length > 0 ? dedupedRight : [...fallback.right],
  };
}

function hasKey(settings: ControlSettings, side: TurnSide, key: string, exceptIndex?: number): boolean {
  const list = settings[side];
  return list.some((entry, index) => entry === key && index !== exceptIndex);
}

function emitChange(settings: ControlSettings): void {
  EventBus.emit('controls-changed', cloneSettings(settings));
}

class ControlSettingsStore {
  private _settings: ControlSettings = cloneSettings(DEFAULT_CONTROL_SETTINGS);

  constructor() {
    this._settings = this.load();
  }

  /** Load settings from localStorage, falling back to defaults. */
  load(): ControlSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this._settings = cloneSettings(DEFAULT_CONTROL_SETTINGS);
        return cloneSettings(this._settings);
      }
      this._settings = sanitizeSettings(JSON.parse(raw));
      return cloneSettings(this._settings);
    } catch {
      this._settings = cloneSettings(DEFAULT_CONTROL_SETTINGS);
      return cloneSettings(this._settings);
    }
  }

  /** Persist current settings to localStorage. */
  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    emitChange(this._settings);
  }

  /** Restore defaults and remove persisted settings. */
  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this._settings = cloneSettings(DEFAULT_CONTROL_SETTINGS);
    emitChange(this._settings);
  }

  getSettings(): ControlSettings {
    return cloneSettings(this._settings);
  }

  canAddKey(side: TurnSide): boolean {
    return this._settings[side].length < MAX_KEYS_PER_DIRECTION;
  }

  /** Append a binding key to the given side if valid and under the cap. */
  addKey(side: TurnSide, key: string): boolean {
    if (!this.canAddKey(side)) return false;
    const normalized = normalizeBindingKey(key);
    if (!isAllowedBindingKey(normalized)) return false;
    if (hasKey(this._settings, side, normalized)) return false;
    if (hasKey(this._settings, side === 'left' ? 'right' : 'left', normalized)) return false;

    this._settings[side].push(normalized);
    this.save();
    return true;
  }

  /** Remove a binding by index; blocked when only one key remains. */
  removeKey(side: TurnSide, index: number): boolean {
    const list = this._settings[side];
    if (list.length <= 1 || index < 0 || index >= list.length) return false;
    list.splice(index, 1);
    this.save();
    return true;
  }

  /** Replace a binding at index with a new key. */
  rebindKey(side: TurnSide, index: number, key: string): boolean {
    const list = this._settings[side];
    if (index < 0 || index >= list.length) return false;

    const normalized = normalizeBindingKey(key);
    if (!isAllowedBindingKey(normalized)) return false;
    if (hasKey(this._settings, side, normalized, index)) return false;
    if (hasKey(this._settings, side === 'left' ? 'right' : 'left', normalized)) return false;

    list[index] = normalized;
    this.save();
    return true;
  }
}

export const controlSettings = new ControlSettingsStore();