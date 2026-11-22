import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Writes dist/sw.js after the build: precaches every output file so the game works offline
 * (iPhone "Add to Home Screen"). The cache name is a hash of all file contents, so each deploy
 * gets a fresh cache and old ones are deleted.
 */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'whiplash-offline-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else if (name !== 'sw.js' && !name.startsWith('.')) files.push(relative(outDir, p).split(sep).join('/'));
        }
      };
      walk(outDir);
      files.sort();
      const hash = createHash('sha1');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const precache = ['./', ...files];
      writeFileSync(join(outDir, 'sw.js'), SW_SOURCE.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(precache, null, 2)));
    },
  };
}

const SW_SOURCE = `// Generated at build time by vite.config.ts — do not edit.
const CACHE = 'whiplash-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('whiplash-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Page: try the network briefly so new deploys show up, fall back to the cached copy offline.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        if (res.ok) return res;
      } catch { /* offline or slow: use the cache */ }
      return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
    })());
    return;
  }
  // Assets have content hashes in their names: cache first.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`;

// Relative base so the build works on GitHub Pages under /<repo>/ and as a plain static folder.
export default defineConfig({
  base: './',
  plugins: [offlineServiceWorker()],
  // Shown on the title screen as "Updated …" so you can tell which build is running.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
