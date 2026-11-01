/**
 * Shared night grading for everything drawn on top of the background: each
 * colour is pulled a little toward the scene's moonlit blue, so pipes, pigs
 * and pickups sit inside the blue night instead of looking pasted on.
 */
const NIGHT_BLUE = [112, 134, 224];
const NIGHT_AMOUNT = 0.12;

export function nightTint(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  // Blend toward a blue-filtered version of the colour (keeps its value) plus a
  // touch of the scene blue itself.
  return rgb.map((channel, index) => {
    const filtered = channel * 0.55 + NIGHT_BLUE[index] * 0.45;
    return Math.round(channel * (1 - NIGHT_AMOUNT) + filtered * NIGHT_AMOUNT);
  }) as [number, number, number];
}

export function nightTintCss(hex: string): string {
  const [r, g, b] = nightTint(hex);
  return `rgb(${r}, ${g}, ${b})`;
}
