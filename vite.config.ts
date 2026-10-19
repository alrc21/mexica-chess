import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Asset folders rewritten by the Blender and audio pipelines shouldn't reload the page.
  server: { watch: { ignored: ['**/public/audio/**', '**/public/models/**', '**/blender/**'] } },
});
