// The application's only source of "now". Route handlers call now(); the pure rule
// functions underneath take a timestamp as a parameter instead, so every boundary in
// MR-PLT-03 and MR-STO-08 is testable without a clock at all. This module exists for the
// handlers, which have to get the value from somewhere.

let source: () => number = () => Date.now();

export function now(): number {
  return source();
}

/** Test seam. Fixes the clock so a handler-level test can sit on a stated boundary. */
export function setClock(fixed: number | (() => number)): void {
  source = typeof fixed === 'number' ? () => fixed : fixed;
}

export function resetClock(): void {
  source = () => Date.now();
}
