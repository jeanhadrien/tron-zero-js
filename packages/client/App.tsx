import { createSignal, onMount, onCleanup } from 'solid-js';
import { PhaserGame } from './PhaserGame';
import DebugConsole from './components/DebugConsole';
import FpsCounter from './components/FpsCounter';
import Chat from './components/Chat';
import MainMenu from './components/MainMenu';
import { EventBus } from './game/EventBus';
import type { GameScene } from './game/scenes/GameScene';

const App = () => {
    const [gameScene, setGameScene] = createSignal<GameScene | null>(null);

    onMount(() => {
        const handler = ({ host, port }: { host: string; port: number }) => {
            const scene = gameScene();
            if (scene) {
                scene.connectToServer(host, port);
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
            <DebugConsole />
            <FpsCounter />
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
                v{__APP_VERSION__}
            </div>
        </div>
    );
};

export default App;
