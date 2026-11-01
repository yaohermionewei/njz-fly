import blue1 from '../NJZPowerpuffGirls/blue1.webp';
import blue2 from '../NJZPowerpuffGirls/blue2.webp';
import blue3 from '../NJZPowerpuffGirls/blue3.webp';
import blue4 from '../NJZPowerpuffGirls/blue4.webp';
import blue5 from '../NJZPowerpuffGirls/blue5.webp';
import green1 from '../NJZPowerpuffGirls/green1.webp';
import green2 from '../NJZPowerpuffGirls/green2.webp';
import green3 from '../NJZPowerpuffGirls/green3.webp';
import green4 from '../NJZPowerpuffGirls/green4.webp';
import green5 from '../NJZPowerpuffGirls/green5.webp';
import pink1 from '../NJZPowerpuffGirls/pink1.webp';
import pink2 from '../NJZPowerpuffGirls/pink2.webp';
import pink3 from '../NJZPowerpuffGirls/pink3.webp';
import pink4 from '../NJZPowerpuffGirls/pink4.webp';
import pink5 from '../NJZPowerpuffGirls/pink5.webp';
import yellow1 from '../NJZPowerpuffGirls/yellow1.webp';
import yellow2 from '../NJZPowerpuffGirls/yellow2.webp';
import yellow3 from '../NJZPowerpuffGirls/yellow3.webp';
import yellow4 from '../NJZPowerpuffGirls/yellow4.webp';
import yellow5 from '../NJZPowerpuffGirls/yellow5.webp';
import purple1 from '../NJZPowerpuffGirls/purple1.webp';
import purple2 from '../NJZPowerpuffGirls/purple2.webp';
import purple3 from '../NJZPowerpuffGirls/purple3.webp';
import purple4 from '../NJZPowerpuffGirls/purple4.webp';
import purple5 from '../NJZPowerpuffGirls/purple5.webp';

const TRAIL_COLORS = {
  blue: { hex: '#8AAEE0', rgb: '138, 174, 224' },
  green: { hex: '#A2E48E', rgb: '162, 228, 142' },
  pink: { hex: '#D782B7', rgb: '215, 130, 183' },
  yellow: { hex: '#F6C263', rgb: '246, 194, 99' },
  purple: { hex: '#A67EDE', rgb: '166, 126, 222' },
} as const;

/** The five members; the player is one of them at a time (member tokens switch). Order matches `MEMBER_TOKENS`. */
export const SQUAD = [
  { frames: [blue1, blue2, blue3, blue4, blue5], trail: TRAIL_COLORS.blue },
  { frames: [green1, green2, green3, green4, green5], trail: TRAIL_COLORS.green },
  { frames: [pink1, pink2, pink3, pink4, pink5], trail: TRAIL_COLORS.pink },
  { frames: [yellow1, yellow2, yellow3, yellow4, yellow5], trail: TRAIL_COLORS.yellow },
  { frames: [purple1, purple2, purple3, purple4, purple5], trail: TRAIL_COLORS.purple },
] as const;
export const SQUAD_FRAME_COUNT = 5;

