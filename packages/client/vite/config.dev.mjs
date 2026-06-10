import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const appVersion = process.env.APP_VERSION || 'dev';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [solid()],
  server: {
    port: 8080,
  },
});

