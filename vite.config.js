import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'public',
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id) return;
          if (id.includes('node_modules/phaser')) return 'vendor-phaser';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('/src/scenes/BattleScene.js')) return 'scene-battle';
          if (id.includes('/src/scenes/NodeMapScene.js')) return 'scene-nodemap';
          if (id.includes('/src/scenes/HomeBaseScene.js')) return 'scene-homebase';
          if (id.includes('/src/scenes/TitleScene.js')) return 'scene-title';
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true
  }
});
