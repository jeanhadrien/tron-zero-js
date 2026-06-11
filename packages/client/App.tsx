import { createSignal, onMount, onCleanup } from 'solid-js';
import { PhaserGame } from './PhaserGame';
import Chat from './components/Chat';
import MainMenu from './components/MainMenu';
import { EventBus } from './game/managers/EventBus';
import type { GameScene } from './game/scenes/GameScene';

const App = () => {
    const [gameScene, setGameScene] = createSignal<GameScene | null>(null);

    onMount(() => {
        const handler = ({ host, port, secure }: { host: string; port: number; secure?: boolean }) => {
            const scene = gameScene();
            if (scene) {
                scene.connectToServer(host, port, secure);
            }
        };
        EventBus.on('connect-to-server', handler);
        onCleanup(() => EventBus.off('connect-to-server', handler));
    });

    return (
        <div id="app" style={{ position: 'relative' }}>
            <PhaserGame
                currentActiveScene={(scene) => setGameScene(scene as GameScene)}
            />
            <MainMenu />
            <Chat />
            <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                color: 'rgba(255, 255, 255, 0.5)',
                'font-family': 'monospace',
                'font-size': '12px',
                'pointer-events': 'none',
                'z-index': 1000
            }}>
                {__APP_VERSION__}
            </div>
        </div>
    );
};

export default App;
