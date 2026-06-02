import { createSignal } from 'solid-js';
import { EventBus } from '../game/managers/EventBus';

const DebugConsole = () => {
    const [isInvincible, setIsInvincible] = createSignal(false);
    const [isCameraFollowing, setIsCameraFollowing] = createSignal(true);

    return (
        <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            'z-index': 1000,
            'pointer-events': 'auto',
        }}>
            <button 
                onClick={() => {
                    const nextState = !isInvincible();
                    setIsInvincible(nextState);
                    EventBus.emit('toggle-invincibility', nextState);
                }} 
                style={{ 
                    display: 'block',
                    'margin-bottom': '4px', 
                    padding: '5px 8px', 
                    cursor: 'pointer', 
                    background: '#333', 
                    color: isInvincible() ? '#0f0' : '#888', 
                    border: `1px solid ${isInvincible() ? '#0f0' : '#888'}`,
                    'font-family': 'monospace',
                    'font-size': '14px',
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
                    padding: '5px 8px', 
                    cursor: 'pointer', 
                    background: '#333', 
                    color: isCameraFollowing() ? '#0f0' : '#888', 
                    border: `1px solid ${isCameraFollowing() ? '#0f0' : '#888'}`,
                    'font-family': 'monospace',
                    'font-size': '14px',
                }}
            >
                Camera Follows Player
            </button>
        </div>
    );
};

export default DebugConsole;
