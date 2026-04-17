import { createSignal, onMount, onCleanup } from 'solid-js';
import { EventBus } from '../game/EventBus';

interface DebugValue {
    name: string;
    value: string;
}

const DebugConsole = () => {
    const [debugData, setDebugData] = createSignal<DebugValue[]>([]);

    onMount(() => {
        const handleDebugUpdate = (data: DebugValue[]) => {
            setDebugData(data);
        };

        EventBus.on('debug-update', handleDebugUpdate);

        onCleanup(() => {
            EventBus.removeListener('debug-update', handleDebugUpdate);
        });
    });

    return (
        <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            'background-color': 'rgba(0, 0, 0, 0.7)',
            color: '#00ff00',
            padding: '10px',
            'border-radius': '5px',
            'font-family': 'monospace',
            'font-size': '14px',
            'z-index': 1000,
            'pointer-events': 'none',
        }}>
            <h3 style={{ margin: '0 0 5px 0', 'font-size': '16px', color: '#fff' }}>Debug Console</h3>
            {debugData().map((item) => (
                <div style={{ display: 'flex', 'justify-content': 'space-between', width: '150px' }}>
                    <span style={{ 'font-weight': 'bold', 'margin-right': '10px' }}>{item.name}:</span>
                    <span>{item.value}</span>
                </div>
            ))}
        </div>
    );
};

export default DebugConsole;