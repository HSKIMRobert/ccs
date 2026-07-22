import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const UI_ROOT = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..');

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(REPO_ROOT, './src/shared'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks - split large dependencies
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'radix-ui': [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'tanstack': ['@tanstack/react-query', '@tanstack/react-table'],
          'form-utils': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'icons': ['lucide-react'],
          // Charts - large library, separate chunk
          'charts': ['recharts'],
          // Code editor / syntax highlighting
          'code-highlight': ['prism-react-renderer'],
          // Notifications
          'notifications': ['sonner'],
          // Utilities
          'utils': ['date-fns', 'clsx', 'class-variance-authority', 'tailwind-merge', 'yaml'],
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [UI_ROOT, REPO_ROOT],
    },
    proxy: {
      // The dashboard's CSRF guard rejects loopback origins on a different
      // port, so the dev proxy must present the API server's own origin.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        headers: { origin: 'http://localhost:3000' },
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
        headers: { origin: 'http://localhost:3000' },
      },
    },
  },
});
