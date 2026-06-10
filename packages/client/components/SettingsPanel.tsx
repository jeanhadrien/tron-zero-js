import { createSignal, createEffect, onMount, onCleanup, For, Show } from 'solid-js';
import { EventBus } from '../game/managers/EventBus';
import {
  controlSettings,
  formatBindingLabel,
  isAllowedBindingKey,
  MAX_KEYS_PER_DIRECTION,
  normalizeBindingKey,
  type ControlSettings,
  type TurnSide,
} from '../settings/ControlSettings';

type ListenTarget = { side: TurnSide; index: number | 'add' };

const SettingsPanel = () => {
  const [settings, setSettings] = createSignal<ControlSettings>(controlSettings.getSettings());
  const [listenTarget, setListenTarget] = createSignal<ListenTarget | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    EventBus.emit('controls-listen-active', listenTarget() !== null);
  });

  const onControlsChanged = (next: ControlSettings) => {
    setSettings(next);
  };

  const startListen = (side: TurnSide, index: number | 'add') => {
    setError(null);
    setListenTarget({ side, index });
  };

  const cancelListen = () => {
    setListenTarget(null);
    setError(null);
  };

  const handleCaptureKeyDown = (e: KeyboardEvent) => {
    const target = listenTarget();
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      cancelListen();
      return;
    }

    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;

    const key = normalizeBindingKey(e.key);
    if (!isAllowedBindingKey(key)) {
      setError('Only letter keys and arrow keys are allowed.');
      return;
    }

    const ok =
      target.index === 'add'
        ? controlSettings.addKey(target.side, key)
        : controlSettings.rebindKey(target.side, target.index, key);

    if (!ok) {
      setError('Key already bound or invalid.');
      return;
    }

    cancelListen();
  };

  onMount(() => {
    EventBus.on('controls-changed', onControlsChanged);
    window.addEventListener('keydown', handleCaptureKeyDown, true);
  });

  onCleanup(() => {
    EventBus.emit('controls-listen-active', false);
    EventBus.off('controls-changed', onControlsChanged);
    window.removeEventListener('keydown', handleCaptureKeyDown, true);
  });

  const handleReset = () => {
    controlSettings.reset();
    cancelListen();
  };

  const renderSide = (side: TurnSide, label: string) => {
    const keys = () => settings()[side];
    const listening = () => listenTarget()?.side === side;

    return (
      <div class="settings-section">
        <div class="settings-section-header">
          <span class="settings-section-title">{label}</span>
          <span class="settings-hint">
            {keys().length} / {MAX_KEYS_PER_DIRECTION} keys
          </span>
        </div>
        <div class="settings-key-list">
          <For each={keys()}>
            {(key, index) => (
              <div
                classList={{
                  'settings-key-chip': true,
                  listening: listening() && listenTarget()?.index === index(),
                }}
              >
                <button
                  type="button"
                  class="settings-bind-btn"
                  onClick={() => startListen(side, index())}
                >
                  {listening() && listenTarget()?.index === index() ? 'Press a key…' : formatBindingLabel(key)}
                </button>
                <button
                  type="button"
                  class="settings-remove-btn"
                  disabled={keys().length <= 1}
                  title={keys().length <= 1 ? 'At least one key required' : 'Remove key'}
                  onClick={() => controlSettings.removeKey(side, index())}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={keys().length < MAX_KEYS_PER_DIRECTION}>
            <button
              type="button"
              classList={{
                'settings-add-btn': true,
                listening: listening() && listenTarget()?.index === 'add',
              }}
              onClick={() => startListen(side, 'add')}
            >
              {listening() && listenTarget()?.index === 'add' ? 'Press a key…' : '+ Add key'}
            </button>
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div class="settings-panel">
      <p class="settings-description">
        Turn keys match key labels on your keyboard (works on AZERTY and QWERTY). Click a key to rebind.
      </p>

      {renderSide('left', 'Left turn')}
      {renderSide('right', 'Right turn')}

      <Show when={error()}>
        <div class="settings-error">{error()}</div>
      </Show>

      <div class="settings-actions">
        <button type="button" class="settings-reset-btn" onClick={handleReset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;