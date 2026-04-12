// Polyfill for Phaser in JSDOM environments
import 'jsdom-worker';

if (typeof window !== 'undefined') {
    // Phaser requires canvas to boot even in headless mode
    const canvas = document.createElement('canvas');
    if (!window.HTMLCanvasElement) {
        // @ts-ignore
        window.HTMLCanvasElement = canvas.constructor;
    }
}
