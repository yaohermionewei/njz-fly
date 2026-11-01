export interface SimulationStep { dt: number; now: number }

/** Keep elapsed time at low frame rates; small steps still prevent tunnelling. */
export function phoneFrameSteps(previous: number, now: number, blockedUntil = 0): SimulationStep[] {
  // Background tabs pause explicitly. Bound exceptional foreground stalls so
  // returning from a stopped debugger cannot simulate minutes in one frame.
  const start = Math.max(previous, now - 250, blockedUntil);
  const elapsed = Math.max(0, now - start);
  const count = Math.ceil(elapsed / (1000 / 60));
  return Array.from({ length: count }, (_, i) => ({ dt: elapsed / count / 1000, now: start + elapsed * (i + 1) / count }));
}
