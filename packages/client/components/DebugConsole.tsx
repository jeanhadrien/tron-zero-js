import { createSignal, onMount, onCleanup } from 'solid-js';
import { EventBus } from '../game/EventBus';

interface DebugValue {
    name: string;
    value: string;
}

const DebugConsole = () => {
    const [debugData, setDebugData] = createSignal<DebugValue[]>([]);
    const [isInvincible, setIsInvincible] = createSignal(false);
    const [isCameraFollowing, setIsCameraFollowing] = createSignal(true);

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
            'pointer-events': 'auto',
        }}>
            <h3 style={{ margin: '0 0 5px 0', 'font-size': '16px', color: '#fff' }}>Debug Console</h3>
            {debugData().map((item) => (
                <div style={{ display: 'flex', 'justify-content': 'space-between', width: '150px' }}>
                    <span style={{ 'font-weight': 'bold', 'margin-right': '10px' }}>{item.name}:</span>
                    <span>{item.value}</span>
                </div>
            ))}
            <button 
                onClick={() => {
                    const nextState = !isInvincible();
                    setIsInvincible(nextState);
                    EventBus.emit('toggle-invincibility', nextState);
                }} 
                style={{ 
                    display: 'block',
                    'margin-top': '10px', 
                    padding: '5px', 
                    cursor: 'pointer', 
                    background: '#333', 
                    color: isInvincible() ? '#0f0' : '#888', 
                    border: `1px solid ${isInvincible() ? '#0f0' : '#888'}` 
                }}
            >
                Toggle Invincibility
            </button>
            <button 
                onClick={() => {
                    const nextState = !isCameraFollowing();
                    setIsCameraFollowing(nextState);
                    EventBus.emit('toggle-camera-follow', nextState);
                }} 
                style={{ 
                    display: 'block',
                    'margin-top': '10px', 
                    padding: '5px', 
                    cursor: 'pointer', 
                    background: '#333', 
                    color: isCameraFollowing() ? '#0f0' : '#888', 
                    border: `1px solid ${isCameraFollowing() ? '#0f0' : '#888'}` 
                }}
            >
                Camera Follows Player
            </button>
        </div>
    );
};

export default DebugConsole;