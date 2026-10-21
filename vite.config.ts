import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Blender's working files churn during bakes; they're not served, don't watch them.
  server: { watch: { ignored: ['**/blender/**'] } },
  // Two pages: the game, and the About (served as /about on Vercel: cleanUrls).
  build: { rolldownOptions: { input: { main: 'index.html', about: 'about.html' } } },
});
