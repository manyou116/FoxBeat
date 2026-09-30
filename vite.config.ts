import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageInfo from './package.json' with { type: 'json' };

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(packageInfo.version) },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, target: ['es2022', 'safari16'] },
});
