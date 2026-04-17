import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
const appVersion = pkg.version;

// https://vitejs.dev/config/
export default defineConfig({
    define: {
        "__APP_VERSION__": JSON.stringify(appVersion),
    },
    plugins: [
        solid(),
    ],
    server: {
        port: 8080
    }
})
