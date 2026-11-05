/** Dimensions shared by drawing, mobile layout and its visual-clearance checks. */
export const PICKUP_HEIGHT = { stick: 48, heal: 36, power: 60, morph: 58 } as const;
export type PickupArt = keyof typeof PICKUP_HEIGHT;
export const PIG_VISUAL_ASPECT = 27 / 25;

/** Maximum frame width includes rounded sidewalls; height includes independent hover phases. */
export function pickupEnvelope(art: PickupArt, scale: number) {
  const height = PICKUP_HEIGHT[art] * scale;
  switch (art) {
    case 'stick': return { width: height * 20 / 26, height: height + 6 };
    case 'heal': return { width: height * 23 / 16, height: height + 8 };
    // Orbiting sparkles, breathing, grid snapping and hover are all included.
    case 'power': return { width: height * 1.56, height: height * 1.56 + 10 };
    case 'morph': return { width: height * 1.56, height: height * 1.56 + 10 };
  }
}
