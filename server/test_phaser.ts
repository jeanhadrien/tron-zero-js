import './setup.ts';

async function main() {
    const Phaser = (await import('phaser')).default;
    console.log("Phaser loaded version:", Phaser.VERSION);

    const game = new Phaser.Game({
        type: Phaser.HEADLESS,
        width: 800,
        height: 600,
        banner: false,
        audio: {
            noAudio: true
        }
    });

    console.log("Headless game instance created.");
    process.exit(0);
}

main();