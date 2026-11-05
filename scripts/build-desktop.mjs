// Bundles the desktop app's main process (with the whole Mote server inside) and its preload script.
// The result has no node_modules to ship: Mote's storage uses the SQLite built into Electron.

import { build } from 'esbuild';

await build({
  entryPoints: ['desktop/main.ts'],
  outfile: 'dist/desktop/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // Some bundled CommonJS packages call require() for Node built-ins.
  banner: { js: "import { createRequire as __moteRequire } from 'node:module'; const require = __moteRequire(import.meta.url);" },
  logLevel: 'info',
});

await build({
  entryPoints: ['desktop/preload.ts'],
  outfile: 'dist/desktop/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'info',
});
