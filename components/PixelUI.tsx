import React, { useState } from 'react';
import { DIGIT_GAP as GLYPH_GAP, DIGIT_GLYPHS as GLYPHS, DIGIT_HEIGHT as GLYPH_HEIGHT, DIGIT_WIDTH as GLYPH_WIDTH } from './pixelDigits';

/**
 * Flat pixel UI: thin one-pixel line icons and, where a touch target needs
 * an edge, a thin notched outline. No bevels, drop shadows or heavy bases,
 * matching the game's flat 2D art.
 */

export type PixelTone = 'line' | 'cream' | 'gold' | 'panel' | 'stage';

const TONES: Record<PixelTone, { stroke: string; fill: string }> = {
  line: { stroke: 'rgba(226, 234, 255, 0.78)', fill: 'rgba(14, 20, 58, 0.28)' },
  cream: { stroke: '#fff6e4', fill: '#fff6e4' },
  gold: { stroke: '#ffd98a', fill: 'rgba(58, 36, 30, 0.3)' },
  panel: { stroke: 'rgba(214, 224, 255, 0.85)', fill: 'rgba(22, 28, 82, 0.94)' },
  stage: { stroke: 'rgba(214, 224, 255, 0.42)', fill: 'rgba(10, 14, 44, 0.66)' },
};

/** Rectangle outline with notched (pixel-rounded) corners, as SVG points. */
function notched(x0: number, y0: number, x1: number, y1: number, cut: number) {
  return [
    [x0 + cut, y0], [x1 - cut, y0], [x1, y0 + cut], [x1, y1 - cut],
    [x1 - cut, y1], [x0 + cut, y1], [x0, y1 - cut], [x0, y0 + cut],
  ].map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * Thin flat pixel outline filling its (relative) parent; one unit ≈ 2 CSS px.
 * `color` overrides the tone with one solid colour (fill and edge), easing between colours.
 */
export const PixelFrame: React.FC<{ tone?: PixelTone; units?: [number, number]; color?: string }> = ({ tone = 'line', units = [28, 28], color: solid }) => {
  const [w, h] = units;
  const color = solid ? { stroke: solid, fill: solid } : TONES[tone];
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" shapeRendering="crispEdges">
      <polygon points={notched(1, 1, w - 1, h - 1, 1)} style={{ fill: color.fill, transition: 'fill 240ms ease-out' }} />
      <g style={{ fill: color.stroke, transition: 'fill 240ms ease-out' }}>
        <rect x={2} y={0} width={w - 4} height={1} />
        <rect x={2} y={h - 1} width={w - 4} height={1} />
        <rect x={0} y={2} width={1} height={h - 4} />
        <rect x={w - 1} y={2} width={1} height={h - 4} />
        {/* Single-pixel corners read as a rounded pixel corner. */}
        <rect x={1} y={1} width={1} height={1} />
        <rect x={w - 2} y={1} width={1} height={1} />
        <rect x={1} y={h - 2} width={1} height={1} />
        <rect x={w - 2} y={h - 2} width={1} height={1} />
      </g>
    </svg>
  );
};

// One-pixel line icons on an 11×11 grid.
const ICONS = {
  heart: [
    '...........',
    '..##...##..',
    '.#..#.#..#.',
    '.#...#...#.',
    '.#.......#.',
    '..#.....#..',
    '...#...#...',
    '....#.#....',
    '.....#.....',
    '...........',
    '...........',
  ],
  download: [
    '.....#.....',
    '.....#.....',
    '.....#.....',
    '..#..#..#..',
    '...#.#.#...',
    '....###....',
    '.....#.....',
    '...........',
    '.#.......#.',
    '.#.......#.',
    '.#########.',
  ],
  up: [
    '...........',
    '.....#.....',
    '....#.#....',
    '...#...#...',
    '..#.....#..',
    '.#.......#.',
    '...........',
  ],
  down: [
    '...........',
    '.#.......#.',
    '..#.....#..',
    '...#...#...',
    '....#.#....',
    '.....#.....',
    '...........',
  ],
  upSolid: [
    '.....#.....',
    '....###....',
    '...#####...',
    '..#######..',
    '.#########.',
    '....###....',
    '....###....',
    '....###....',
    '...........',
  ],
  downSolid: [
    '...........',
    '....###....',
    '....###....',
    '....###....',
    '.#########.',
    '..#######..',
    '...#####...',
    '....###....',
    '.....#.....',
  ],
  bolt: [
    '......###..',
    '.....###...',
    '....###....',
    '...###.....',
    '..#######..',
    '.....###...',
    '....###....',
    '...###.....',
    '..##.......',
    '.#.........',
    '...........',
  ],
  pause: [
    '...........',
    '...##.##...',
    '...##.##...',
    '...##.##...',
    '...##.##...',
    '...##.##...',
    '...##.##...',
    '...........',
  ],
  music: [
    '...........',
    '....######.',
    '....#....#.',
    '....#....#.',
    '....#....#.',
    '..###..###.',
    '.####.####.',
    '..##...##..',
    '...........',
  ],
  sound: [
    '...........',
    '....#......',
    '...##...#..',
    '.###.#...#.',
    '.#...#.#.#.',
    '.#...#.#.#.',
    '.###.#...#.',
    '...##...#..',
    '....#......',
    '...........',
  ],
  attack: [
    '.....#.....',
    '...##.##...',
    '..#.....#..',
    '.#.......#.',
    '.#...#...#.',
    '#.#.###.#.#',
    '.#...#...#.',
    '.#.......#.',
    '..#.....#..',
    '...##.##...',
    '.....#.....',
  ],
  play: [
    '..#....',
    '..##...',
    '..#.#..',
    '..#..#.',
    '..#.#..',
    '..##...',
    '..#....',
  ],
  share: [
    '.....#.....',
    '....###....',
    '...#.#.#...',
    '.....#.....',
    '.....#.....',
    '.#...#...#.',
    '.#.......#.',
    '.#.......#.',
    '.#########.',
  ],
  home: [
    '.....#.....',
    '....#.#....',
    '...#...#...',
    '..#.....#..',
    '.#.......#.',
    '..#.....#..',
    '..#.###.#..',
    '..#.#.#.#..',
    '..###.###..',
  ],
  // Information: a 9×9 circle with a thin "i" (circles read smaller than boxes, so one row taller).
  info: [
    '...........',
    '...#####...',
    '..#.....#..',
    '.#...#...#.',
    '.#.......#.',
    '.#...#...#.',
    '.#...#...#.',
    '.#...#...#.',
    '..#.....#..',
    '...#####...',
    '...........',
  ],
  close: [
    '.#.....#.',
    '..#...#..',
    '...#.#...',
    '....#....',
    '...#.#...',
    '..#...#..',
    '.#.....#.',
  ],
  restart: [
    '...........',
    '...####.#..',
    '..#....##..',
    '.#....###..',
    '.#.........',
    '.#.......#.',
    '..#.....#..',
    '...#####...',
    '...........',
  ],
  // Bold filled icons for the big square pause buttons.
  homeSolid: [
    '.............',
    '......#......',
    '.....###.....',
    '....#####....',
    '...#######...',
    '..#########..',
    '.###########.',
    '...#######...',
    '...#######...',
    '...##...##...',
    '...##...##...',
    '...##...##...',
    '.............',
  ],
  restartSolid: [
    '...#.........',
    '..##.####....',
    '.##########..',
    '########.###.',
    '.###.....###.',
    '..##......##.',
    '...#......##.',
    '..........##.',
    '.##......###.',
    '.###....###..',
    '..########...',
    '....####.....',
    '.............',
  ],
  playSolid: [
    '.............',
    '....#........',
    '....##.......',
    '....###......',
    '....####.....',
    '....#####....',
    '....######...',
    '....#####....',
    '....####.....',
    '....###......',
    '....##.......',
    '....#........',
    '.............',
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

/** Grid-drawn icon in currentColor; `slashed` adds a thin white diagonal "off" line. */
export const PixelIcon: React.FC<{ name: PixelIconName; size?: number; slashed?: boolean; trim?: boolean; className?: string }> = ({ name, size = 20, slashed = false, trim = false, className }) => {
  const rows = ICONS[name];
  const columns = rows[0].length;
  const span = Math.max(columns, rows.length);
  const offsetX = (span - columns) / 2;
  const offsetY = Math.floor((span - rows.length) / 2);
  const pixels = trim && !slashed ? rows.flatMap((row, y) => [...row].flatMap((cell, x) => cell === '#' ? [[x + offsetX, y + offsetY]] : [])) : [];
  const left = pixels.length ? Math.min(...pixels.map(([x]) => x)) : 0;
  const top = pixels.length ? Math.min(...pixels.map(([, y]) => y)) : 0;
  const width = pixels.length ? Math.max(...pixels.map(([x]) => x)) - left + 1 : span;
  const height = pixels.length ? Math.max(...pixels.map(([, y]) => y)) - top + 1 : span;
  return (
    <svg aria-hidden="true" className={className} width={size * width / height} height={size} viewBox={`${left} ${top} ${width} ${height}`} shapeRendering="crispEdges">
      {/* When switched off the icon dims so the white slash stays readable. */}
      <g opacity={slashed ? 0.5 : 1}>
        {rows.flatMap((row, y) => [...row].map((cell, x) => (cell === '#'
          ? <rect key={`${x}-${y}`} x={x + offsetX} y={y + offsetY} width={1} height={1} fill="currentColor" />
          : null)))}
      </g>
      {slashed && Array.from({ length: span - 2 }, (_, index) => (
        <rect key={`slash-${index}`} x={index + 1} y={index + 1} width={1} height={1} fill="#ffffff" />
      ))}
    </svg>
  );
};

type PixelButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Without a tone the button is just its icon, no frame at all. */
  tone?: PixelTone;
  units?: [number, number];
  /** Solid frame colour instead of the tone's. */
  color?: string;
};

/** Flat pixel button; it dips one pixel while pressed. */
export const PixelButton: React.FC<PixelButtonProps> = ({ tone, units, color, className = '', children, ...props }) => (
  <button type="button" {...props} className={`pixel-control relative flex items-center justify-center ${className}`}>
    {tone && <PixelFrame tone={tone} units={units} color={color} />}
    <span className="relative flex items-center justify-center gap-2">{children}</span>
  </button>
);

/** Controls share the menu's stepped keycap art; warm gold marks the attack. */
export const TouchControlButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { action: 'up' | 'down' | 'attack' }> = ({ action, className = '', onPointerDown, onPointerUp, onPointerCancel, onLostPointerCapture, ...props }) => {
  const [held, setHeld] = useState(false);
  const attack = action === 'attack';
  return (
    <KeycapButton
      {...props}
      variant={attack ? 'gold' : 'secondary'}
      depth="soft"
      snow={false}
      width={attack ? 72 : 60}
      height={attack ? 68 : 60}
      data-held={held}
      className={`touch-pad ${attack ? 'touch-pad-attack' : 'touch-pad-move'} ${className}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld(true);
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => { setHeld(false); onPointerUp?.(event); }}
      onPointerCancel={(event) => { setHeld(false); onPointerCancel?.(event); }}
      onLostPointerCapture={(event) => { setHeld(false); onLostPointerCapture?.(event); }}
    >
      <span className="touch-pad-content">
        <PixelIcon name={attack ? 'bolt' : action === 'up' ? 'upSolid' : 'downSolid'} size={attack ? 33 : 22} />
        {attack && <span className="touch-pad-label">发射</span>}
      </span>
    </KeycapButton>
  );
};

/** A number (or "+2" / "×2") in the pixel digit font, 1em tall, in currentColor. */
export const PixelNumber: React.FC<{ text: string | number; className?: string }> = ({ text, className }) => {
  const characters = [...String(text)].filter((character) => GLYPHS[character]);
  const width = Math.max(1, characters.length * (GLYPH_WIDTH + GLYPH_GAP) - GLYPH_GAP);
  const path = characters.map((character, index) => GLYPHS[character]
    .map(([x, y, w, h]) => `M${index * (GLYPH_WIDTH + GLYPH_GAP) + x} ${y}h${w}v${h}h${-w}z`).join('')).join('');
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={`0 0 ${width} ${GLYPH_HEIGHT}`}
      style={{ height: '1em', width: `${width / GLYPH_HEIGHT}em`, display: 'block' }}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
};

/** Height of a snow-capped button's snow above its frame, in grid units. */
const SNOW_RISE = 4;

/**
 * The snow lying on a button: per column, the top and bottom row of the cap
 * (the frame's top edge is row SNOW_RISE). A soft wavy top, tapering ends that
 * curl over the corners, and a few rounded lumps hanging down the front.
 */
function snowCap(columns: number) {
  const drips = [
    { at: 0.13, half: 3, depth: 2 },
    { at: 0.38, half: 4, depth: 1.4 },
    { at: 0.64, half: 3.5, depth: 3 },
    { at: 0.87, half: 3, depth: 1.4 },
  ];
  return Array.from({ length: columns }, (_, x) => {
    // Long soft swells with a smaller ripple; the ends thin out to a single row.
    const wave = 2.2 + 1.1 * Math.sin(x * 0.11 + 0.6) + 0.55 * Math.sin(x * 0.29 + 2.1);
    const end = Math.min(x, columns - 1 - x);
    const rise = Math.max(1, Math.min(Math.round(wave), end + 1, 4));
    // Wrap down the stepped upper corners and overlap the side by two rows;
    // a short overhang here leaves daylight between the snow and the frame.
    let hang = [5, 4, 3, 2][end] ?? 1;
    for (const drip of drips) {
      // Rounded lumps: deepest in the middle, easing off to the sides.
      const offset = Math.abs(x - drip.at * columns) / drip.half;
      if (offset < 1) hang = Math.max(hang, 1 + Math.round(drip.depth * Math.sqrt(1 - offset * offset)));
    }
    return { top: SNOW_RISE - rise, bottom: SNOW_RISE + hang };
  });
}

/** Keycap faces: band colours top to bottom, the lit left edge, the dark bottom lip. */
const KEYCAP_FACES = {
  primary: { light: '#6683e4', mid: '#4e68cc', dark: '#3e55b2', edge: '#9db3ff', lip: '#2f4396' },
  secondary: { light: '#bccaf5', mid: '#a9b9ef', dark: '#96a8e6', edge: '#d6dfff', lip: '#8395d8' },
  gold: { light: '#f6d678', mid: '#ecc05b', dark: '#d6a044', edge: '#fff1b0', lip: '#b67b32' },
} as const;

export type KeycapVariant = keyof typeof KEYCAP_FACES | 'outline';

/**
 * The game's one button shape, a pixel keycap: dark navy edge, stepped round
 * corners and a hard shadow below, drawn in whole grid cells of `cell` CSS px.
 * `primary` is blue with white text; `secondary` is light periwinkle with
 * navy text; `outline` has a transparent face. Snow is optional, for home.
 */
export const KeycapButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: KeycapVariant; depth?: 'regular' | 'soft'; snow?: boolean; width: number; height: number; cell?: number }> = ({ variant = 'primary', depth = 'regular', snow = variant === 'primary', width, height, cell = 2, className = '', style, children, ...props }) => {
  const outlined = variant === 'outline';
  const soft = depth === 'soft';
  const face = KEYCAP_FACES[outlined ? 'secondary' : variant];
  const snowy = snow && !outlined;
  const w = Math.round(width / cell);
  const h = Math.round(height / cell);
  const top = snowy ? SNOW_RISE : 0;
  const bottom = top + h;
  const light = Math.round(top + h * 0.55);
  const dark = Math.round(top + h * 0.82);
  // Three orthogonal steps at each corner. Draw the face on the same grid
  // as its outline so rectangular colour bands never fill the cutouts back in.
  const cornerInsets = [4, 2, 1];
  const insetAt = (row: number) => cornerInsets[Math.min(row, h - 1 - row)] ?? 0;
  const rows = Array.from({ length: h }, (_, row) => {
    const inset = insetAt(row);
    const faceInset = Math.max(inset + 1, insetAt(row - 1), insetAt(row + 1));
    const y = top + row;
    // Touch controls keep a light lower face instead of a heavy dark base.
    const color = soft ? (y < light ? face.light : face.mid) : row === h - 2 ? face.lip : y >= dark ? face.dark : y < light ? face.light : face.mid;
    return { row, y, inset, faceInset, color };
  });
  // Bare buttons centre content inside their frame, excluding the shadow.
  // Snow-covered buttons retain the space below the snow's lip.
  const labelTop = top + 1;
  const labelHeight = snowy ? bottom - 2 - labelTop : h - 2;
  return (
    <button type="button" {...props} className={`pixel-control keycap keycap-${variant} relative shrink-0 ${className}`} style={{ ...style, width: w * cell, height: (h + top + 2) * cell }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h + top + 2}`} shapeRendering="crispEdges">
        {!outlined && <g fill="#0b1034" opacity={soft ? 0.25 : 0.75}>
          {rows.map(({ row, y, inset }) => <rect key={row} x={inset} y={y + (soft ? 1 : 2)} width={w - inset * 2} height={1} />)}
        </g>}
        {rows.map(({ row, y, inset, faceInset, color }) => (
          <g key={row}>
            {outlined ? (
              row === 0 || row === h - 1
                ? <rect x={inset} y={y} width={w - inset * 2} height={1} fill="#bccaf5" />
                : <g fill="#bccaf5">
                  <rect x={inset} y={y} width={faceInset - inset} height={1} />
                  <rect x={w - faceInset} y={y} width={faceInset - inset} height={1} />
                </g>
            ) : <rect x={inset} y={y} width={w - inset * 2} height={1} fill="#1b2363" />}
            {!outlined && row > 0 && row < h - 1 && <>
              <rect x={faceInset} y={y} width={w - faceInset * 2} height={1} fill={color} />
              {y < dark && <rect x={faceInset} y={y} width={1} height={1} fill={face.edge} />}
            </>}
          </g>
        ))}
        {/* The snow: shaded underside, white body, brightest top row. */}
        {snowy && snowCap(w).map(({ top: y0, bottom: y1 }, column) => (
          <g key={column} transform={`translate(${column}, 0)`}>
            <rect y={y0} width={1} height={y1 - y0} fill="#eef3ff" />
            <rect y={y0} width={1} height={1} fill="#ffffff" />
            <rect y={y1 - 1} width={1} height={1} fill="#b9c9f6" />
          </g>
        ))}
      </svg>
      <span className="absolute inset-x-0 flex items-center justify-center gap-2 leading-none" style={{ top: labelTop * cell, height: labelHeight * cell }}>{children}</span>
    </button>
  );
};
