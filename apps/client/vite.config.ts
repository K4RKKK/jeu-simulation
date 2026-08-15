import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Le cœur WebGL de Three.js dépasse légèrement 500 ko minifié. Il est volontairement
    // isolé, mis en cache et désormais chargé seulement à l'entrée dans un monde.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        // Three.js change beaucoup moins souvent que notre interface : le sortir du
        // bundle applicatif permet au navigateur de le conserver en cache entre deux
        // versions du client, au lieu de retélécharger les ~500 ko à chaque changement.
        manualChunks(id) {
          if (id.includes('/node_modules/.pnpm/three@') || id.includes('/node_modules/three/')) {
            return 'three';
          }
          return undefined;
        },
      },
    },
  },
});
