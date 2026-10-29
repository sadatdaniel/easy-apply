import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// tests also cover browser code from web/src, which imports shared code as @shared/…
export default defineConfig({ resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } } });
