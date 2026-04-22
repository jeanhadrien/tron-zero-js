import { createSignal, onMount, onCleanup } from 'solid-js';
import { EventBus } from '../game/EventBus';

const FpsCounter = () => {
    const [fps, setFps] = createSignal<number>(0);

    onMount(() => {
        const handleFpsUpdate = (currentFps: number) => {
            setFps(currentFps);
        };

        EventBus.on('fps-update', handleFpsUpdate);

        onCleanup(() => {
            EventBus.removeListener('fps-update', handleFpsUpdate);
        });
    });

    return (
        <div style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            'background-color': 'rgba(0, 0, 0, 0.7)',
            color: '#00ff00',
            padding: '5px 10px',
            'border-radius': '5px',
            'font-family': 'monospace',
            'font-size': '16px',
            'z-index': 1000,
            'pointer-events': 'none', // let clicks pass through to game
        }}>
            FPS: {Math.round(fps())}
        </div>
    );
};

export default FpsCounter;
