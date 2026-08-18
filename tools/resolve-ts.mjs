/**
 * Lets Node resolve this application's extensionless relative imports.
 *
 * Every module under src/ is written for a bundler: `import { getDb } from '../db/index'`,
 * with no extension. Next and Vitest both resolve that. Node's ESM resolver deliberately
 * does not guess extensions, so running a script under src/ with plain `node` fails on the
 * first relative import, and on every transitive one after it.
 *
 * The alternatives were worse. Rewriting C.0's imports to carry `.ts` everywhere would touch
 * every file in the application to serve one script. Adding a TypeScript runner such as tsx
 * would pull in esbuild, whose install step fetches a platform binary, and the root .npmrc
 * sets ignore-scripts=true precisely because a fetch-on-install step is what made a fresh
 * clone fail at the end of Phase C.0. This hook is twenty lines and needs nothing.
 *
 * Node itself strips the types. Nothing here compiles anything.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[cm]?[jt]sx?$|\.json$|\.node$/.test(specifier);

    if (isRelative && !hasExtension && context.parentURL !== undefined) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = new URL(base.href + suffix);
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
    }

    return nextResolve(specifier, context);
  },
});

export { pathToFileURL };
