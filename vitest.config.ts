import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
    plugins: [
        solid(),
    ],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        alias: {
            // Force phaser to use the pre-built browser version instead of Node source files
            phaser: 'phaser/dist/phaser.js'
        }
    }
});