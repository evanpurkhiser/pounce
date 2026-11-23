import compression from '@polka/compression';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(({command, mode}) => {
  const remote = command === 'serve' && mode === 'remote';

  return {
    experimental: {bundledDev: remote},
    plugins: [
      react(),
      remote && {
        name: 'pounce:compress-remote-dev',
        configureServer(server) {
          server.middlewares.use(compression());
        },
      },
    ],
  };
});
