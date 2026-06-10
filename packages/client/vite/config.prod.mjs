import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const appVersion = process.env.APP_VERSION || 'dev';

process.stdout.write(`Building for production...\n`);
const line = "---------------------------------------------------------";
const msg = `❤️❤️❤️ Tell us about your game! - games@phaser.io ❤️❤️❤️`;
process.stdout.write(`${line}\n${msg}\n${line}\n`);

export default defineConfig({
    define: {
        "__APP_VERSION__": JSON.stringify(appVersion),
    },
    base: './',
    plugins: [
        solid(),
    ],
    logLevel: 'error',
    build: {
        target: 'esnext',
        cssMinify: true,
        minify: 'terser',
        terserOptions: {
            ecma: 2020,
            compress: {
                passes: 2,
                drop_console: process.env.DROP_CONSOLE === 'true'
            },
            mangle: true,
            format: {
                comments: false
            }
        },
        reportCompressedSize: false,
    }
});

