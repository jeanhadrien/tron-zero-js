import './setup.ts';
import { Logger } from '../shared/Logger';

const logger = new Logger('PhaserTest');

async function main() {
    const Phaser = (await import('phaser')).default;
    logger.log("Phaser loaded version:", Phaser.VERSION);

    new Phaser.Game({
        type: Phaser.HEADLESS,
        width: 800,
        height: 600,
        banner: false,
        audio: {
            noAudio: true
        }
    });

    logger.log("Headless game instance created.");
    process.exit(0);
}

main();