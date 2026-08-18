import { defineConfig } from '@playwright/test';

const PORT = 3311;

export default defineConfig({
  testDir: './e2e',

  // Every spec resets one shared SQLite file, so two specs running at once would each be
  // reseeding underneath the other. fullyParallel: false serialises the tests inside a file;
  // workers: 1 is what stops two files running at the same time, and both are needed.
  fullyParallel: false,
  workers: 1,

  // Twice the default. `next dev` compiles a route the first time something requests it, and
  // a fresh clone has no .next cache, so whichever test reaches a route first pays that cost
  // inside its own budget. Found by cloning and running the suite in the fresh clone:
  // one test timed out at 30s on the cold clone and passed everywhere warm, which reads as
  // flakiness and is not. The cost is paid once per route per server, so this ceiling does
  // not slow a warm run.
  timeout: 60_000,

  reporter: process.env.CI ? 'line' : 'list',
  // Two Chromium launches never rasterize text pixel-identically (font antialiasing,
  // subpixel positioning), and a page whose height sits near the viewport boundary can
  // toggle the scrollbar in or out between runs. 2% absorbs that noise while still failing
  // on a real layout or content change.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    // localhost, not 127.0.0.1. `next dev` treats a request for its own chunks from a host
    // it was not started on as cross-origin and blocks it, which leaves the page served but
    // never hydrated: no client component runs, so nothing redirects and every assertion
    // about a control fails for a reason that has nothing to do with the application.
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },

  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}/signin`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Turns on POST /api/v1/test/reset, which 404s without it.
      MERIDIAN_TEST_MODE: '1',
      // A database of its own. Without this the suite resets and reseeds the file a
      // facilitator is running the application against, and a mid-demo `npm run e2e` would
      // silently discard whatever they were showing.
      MERIDIAN_DB: 'meridian-e2e.db',
    },
  },
});
