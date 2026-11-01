import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The engine is compiled with `module: NodeNext`, so every import carries a
 * `.js` extension even though the sources are `.ts`. Node resolves that fine;
 * Vite does not, so map `./foo.js` onto `./foo.ts` when the latter exists.
 * This is what lets the UI import the engine directly, with no build step and
 * no duplicate copy of the engine.
 */
function jsToTs(): Plugin {
  return {
    name: 'js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
      return fs.existsSync(candidate) ? candidate : null;
    },
  };
}

export default defineConfig({
  plugins: [jsToTs(), react()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
