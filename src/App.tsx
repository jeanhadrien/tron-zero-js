import type { IRefPhaserGame } from './PhaserGame';
import { PhaserGame } from './PhaserGame';
import Phaser from 'phaser';
import DebugConsole from './components/DebugConsole';

const App = () => {

    // References to the PhaserGame component (game and scene are exposed)
    let phaserRef: IRefPhaserGame;

    return (
        <div id="app" style={{ position: 'relative' }}>
            <PhaserGame ref={(el: IRefPhaserGame) => phaserRef = el} />
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

    /*     const addSprite = () => {
    
            const scene = phaserRef.scene;
    
            if (scene) {
                // Add a new sprite to the current scene at a random position
                const x = Phaser.Math.Between(64, scene.scale.width - 64);
                const y = Phaser.Math.Between(64, scene.scale.height - 64);
    
                //  `add.sprite` is a Phaser GameObjectFactory method and it returns a Sprite Game Object instance
                scene.add.sprite(x, y, 'star');
    
            }
    
        } */



    /* return (
        <div id="app">
            <PhaserGame ref={(el: IRefPhaserGame) => phaserRef = el} />
            <div>
                <button class="button" onClick={addSprite}>Add New Sprite</button>
            </div>
        </div>
    ); 
    */
};

export default App;
