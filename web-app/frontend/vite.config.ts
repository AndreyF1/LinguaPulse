import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'fs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        // Copy _redirects to dist for Cloudflare Pages SPA routing
        {
          name: 'copy-redirects',
          closeBundle() {
            try {
              copyFileSync('_redirects', 'dist/_redirects');
              console.log('✅ Copied _redirects to dist/');
            } catch (err) {
              console.warn('⚠️  Could not copy _redirects:', err);
            }
          }
        }
      ],
      define: {
        'import.meta.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
