// Bundles a Node service: workspace (@hellogram/*) TypeScript is inlined,
// third-party packages stay external and come from `pnpm deploy --prod`.
//   node ../../tools/build-node.mjs src/server.ts
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const entries = process.argv.slice(2);
if (entries.length === 0) throw new Error('usage: build-node.mjs <entry> [...entries]');

// Only the service's own dependencies stay external (they're in its node_modules after
// `pnpm deploy --prod`); everything else, incl. transitive deps of workspace packages, is bundled.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const direct = new Set(Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@hellogram/')));
const packageName = (p) => (p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]);

await build({
  entryPoints: entries,
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  target: 'node22',
  // Node built-ins without the node: prefix (used by some CJS deps).
  external: ['fs', 'path', 'os', 'crypto', 'stream', 'util', 'events', 'http', 'https', 'net', 'tls', 'zlib', 'url', 'buffer', 'child_process', 'worker_threads', 'dns', 'assert', 'querystring', 'string_decoder', 'timers', 'module', 'perf_hooks', 'async_hooks', 'diagnostics_channel', 'http2', 'dgram', 'readline', 'v8', 'vm', 'tty', 'constants', 'punycode', 'process'],
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  // ESM bundles need require() for the few CJS deps that call it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('node:') || direct.has(packageName(args.path))) return { path: args.path, external: true };
          return undefined; // bundle
        });
      },
    },
  ],
});
