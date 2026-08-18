import { configDefaults, defineConfig } from 'vitest/config';

// e2e/ is the Playwright suite and runs through `npm run e2e`; Vitest must not collect it.
// `npm test` stays unit and API and stays fast.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/e2e/**'],
  },
});
