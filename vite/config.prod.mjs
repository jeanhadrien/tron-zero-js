import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const appVersion = pkg.version;

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
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    }
});

