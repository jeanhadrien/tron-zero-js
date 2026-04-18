import { PhaserGame } from './PhaserGame';
import DebugConsole from './components/DebugConsole';

const App = () => {
    return (
        <div id="app" style={{ position: 'relative' }}>
            <PhaserGame />
            <DebugConsole />
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
