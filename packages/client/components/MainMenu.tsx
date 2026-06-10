import { createSignal, createEffect, onMount, onCleanup, Show, Switch, Match } from 'solid-js';
import { EventBus } from '../game/managers/EventBus';
import ServerBrowser from './ServerBrowser';
import SettingsPanel from './SettingsPanel';

const MainMenu = () => {
  const [show, setShow] = createSignal(true);
  const [tab, setTab] = createSignal<'servers' | 'settings'>('servers');

  createEffect(() => {
    EventBus.emit(show() ? 'menu-open' : 'menu-closed');
  });

  onMount(() => {
    const onMenuToggle = () => setShow((prev) => !prev);
    EventBus.on('input:menu-toggle', onMenuToggle);

    const onConnectionState = (state: string) => {
      if (state === 'connected') {
        setShow(false);
      } else if (state === 'disconnected' && document.visibilityState === 'visible') {
        setShow(true);
      }
    };
    EventBus.on('connection-state', onConnectionState);

    onCleanup(() => {
      EventBus.off('input:menu-toggle', onMenuToggle);
      EventBus.off('connection-state', onConnectionState);
    });
  });

  return (
    <Show when={show()}>
      <div class="menu-backdrop">
        <div class="menu-panel">
          <div style={{ 'text-align': 'center', 'margin-bottom': '16px', 'font-size': '20px', 'font-weight': 'bold', 'letter-spacing': '4px' }}>
            TRON ZERO
          </div>
          <div class="menu-tabs">
            <button
              classList={{ 'menu-tab': true, active: tab() === 'servers' }}
              onClick={() => setTab('servers')}
            >
              Servers
            </button>
            <button
              classList={{ 'menu-tab': true, active: tab() === 'settings' }}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </div>
          <Switch>
            <Match when={tab() === 'servers'}>
              <ServerBrowser />
            </Match>
            <Match when={tab() === 'settings'}>
              <SettingsPanel />
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
};

export default MainMenu;
