import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { drawPipe } from './pipeArt';
import { PICKUP_HEIGHT } from './gameMetrics';
import { pickupPolygon, pipeVisualPolygon, validatePhoneLayout } from './phoneLayouts';
import { PHONE_ENTITY_SCALE } from './displayProfile';
import { drawCollectible, drawHeartPickup, drawMemberToken, drawPig, drawSunflower } from './gameArt';
import {
  BAR,
  BEAT,
  PIG_HEIGHT,
  PIG_WIDTH,
  PIPE_THICKNESS,
  ROLE_LABELS,
  SEGMENTS,
  SOLVER_ROWS,
  SOLVER_STEP,
  SONG_SECTIONS,
  THEME_LABELS,
  WORLD_HEIGHT,
  buildSegment,
  createRandom,
  pigCenterY,
  pigPatrolHalfSpan,
  pipeOrientation,
  pipeDrawOrder,
  planSong,
  segmentWidth,
  solveSegment,
  solverRowY,
  type CoinRole,
  type SegmentDef,
  type SegmentTheme,
} from './levelSegments';

/** Dev page (`?segments`): every hand-authored segment rendered with game art. */

const PREVIEW_SCALE = 0.34;
const ROLE_COLORS: Record<CoinRole, string> = {
  guide: '#7fd6ff',
  reward: '#ffd66b',
  risk: '#ff8a65',
  kill: '#ff6fae',
  bonus: '#b69bff',
  heal: '#7be08f',
  riskHeal: '#ff4f7a',
  power: '#ffe04a',
  morph: '#ffffff',
};
const INTENSITY_COLORS = ['#5fb98d', '#7fb3ff', '#f2b14c', '#ff6f7d'];
const TIER_LABELS = ['', '起 · 教学', '承 · 发展', '转 · 变化'];
const THEME_ORDER: SegmentTheme[] = ['intro', 'bonus', 'gate', 'split', 'pig', 'blocks', 'wall', 'combo'];

interface PreviewProps {
  segment: SegmentDef;
  mirrored: boolean;
  variant: number;
  showReach: boolean;
  phone: boolean;
  showSpacing: boolean;
}

const SegmentCanvas: React.FC<PreviewProps> = ({ segment, mirrored, variant, showReach, phone, showSpacing }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = phone ? PHONE_ENTITY_SCALE : 1;
  const width = segmentWidth(segment, scale);
  const content = useMemo(
    () => buildSegment(segment, mirrored, createRandom(variant * 7919 + 1), scale),
    [segment, mirrored, variant, scale],
  );
  const solved = useMemo(() => solveSegment(content, width), [content, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * PREVIEW_SCALE * dpr);
    canvas.height = Math.round(WORLD_HEIGHT * PREVIEW_SCALE * dpr);
    context.setTransform(PREVIEW_SCALE * dpr, 0, 0, PREVIEW_SCALE * dpr, 0, 0);

    context.fillStyle = '#16224d';
    context.fillRect(0, 0, width, WORLD_HEIGHT);
    const beat = BEAT * scale, bar = BAR * scale;
    for (let x = 0; x <= width + 1; x += beat) {
      const isBar = Math.abs(x % bar) < 1 || Math.abs((x % bar) - bar) < 1;
      context.fillStyle = isBar ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
      context.fillRect(x - (isBar ? 2 : 1), 0, isBar ? 4 : 2, WORLD_HEIGHT);
    }

    if (showReach) {
      context.fillStyle = 'rgba(110, 231, 160, 0.16)';
      solved.reach.forEach((column, index) => {
        for (let row = 0; row < SOLVER_ROWS; row += 1) {
          if (column[row]) context.fillRect(index * SOLVER_STEP - SOLVER_STEP / 2, solverRowY(row) - 3, SOLVER_STEP, 6);
        }
      });
    }

    pipeDrawOrder(content.pipes).forEach(index => {
      const pipe = content.pipes[index];
      const { orientation, rotation } = pipeOrientation(pipe);
      drawPipe(context, {
        id: index + 1,
        x: pipe.x,
        width: orientation === 'horizontal' ? pipe.length : PIPE_THICKNESS * scale,
        height: orientation === 'horizontal' ? PIPE_THICKNESS * scale : pipe.length,
        pipeOrientation: orientation,
        pipeRotation: rotation,
      }, pipe.y);
    });

    content.pigs.forEach((pig, index) => {
      const support = content.pipes[pig.pipe];
      const span = pigPatrolHalfSpan(support, pig);
      const y = pigCenterY(support);
      if (span > 0) {
        context.strokeStyle = 'rgba(255, 140, 190, 0.85)';
        context.setLineDash([12, 10]);
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(support.x - span, y - PIG_HEIGHT * 0.7);
        context.lineTo(support.x + span, y - PIG_HEIGHT * 0.7);
        context.stroke();
        context.setLineDash([]);
      }
      drawPig(context, support.x + span * (pig.phase * 2 - 1), y, PIG_WIDTH * scale, PIG_HEIGHT * scale, 1, index * 0.3, 0);
    });

    content.coins.forEach((coin) => {
      context.fillStyle = ROLE_COLORS[coin.role];
      context.globalAlpha = 0.55;
      context.beginPath();
      context.arc(coin.x, coin.y, 17, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
      if (coin.role === 'power') drawSunflower(context, coin.x, coin.y, PICKUP_HEIGHT.power * scale);
      else if (coin.role === 'morph') drawMemberToken(context, coin.member ?? 0, coin.x, coin.y, PICKUP_HEIGHT.morph * scale);
      else if (coin.role === 'heal' || coin.role === 'riskHeal') drawHeartPickup(context, coin.x, coin.y, PICKUP_HEIGHT.heal * scale);
      else drawCollectible(context, coin.x, coin.y, PICKUP_HEIGHT.stick * scale);
    });

    if (phone && showSpacing) {
      const outline = (points: Array<{x: number; y: number}>, color: string) => {
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.closePath();
        context.stroke();
      };
      content.pipes.forEach(pipe => outline(pipeVisualPolygon(pipe), '#7bd8e8'));
      content.coins.forEach(coin => outline(pickupPolygon(coin, scale), coin.patternId ? '#ce9eff' : '#ffe18c'));
      for (const route of content.routes ?? []) {
        context.strokeStyle = route.main ? '#9effba' : '#ffc06d';
        context.lineWidth = route.main ? 4 : 2;
        context.beginPath();
        route.points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.stroke();
      }
      const issues = validatePhoneLayout(content, width);
      issues.forEach(issue => {
        context.strokeStyle = '#ff476e'; context.lineWidth = 4;
        context.strokeRect(issue.x - 20, issue.y - 20, 40, 40);
      });
      context.font = '18px NJZPixelZh'; context.fillStyle = issues.length ? '#ff8da3' : '#a4f5bb';
      context.fillText(issues.length ? `间距问题：${issues.length}` : '间距与完整角色通行检查通过', 12, 28);
    }

    solved.unreachableCoins.forEach((coin) => {
      context.strokeStyle = '#ff3b3b';
      context.lineWidth = 6;
      context.strokeRect(coin.x - 26, coin.y - 26, 52, 52);
    });
  }, [content, showReach, showSpacing, phone, scale, solved, width]);

  return (
    <canvas
      ref={canvasRef}
      className="block rounded-lg"
      style={{ width: width * PREVIEW_SCALE, maxWidth: '100%', height: 'auto', imageRendering: 'pixelated' }}
    />
  );
};

const IntensityDots: React.FC<{ value: number }> = ({ value }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`强度 ${value}`}>
    {[0, 1, 2].map((index) => (
      <span
        key={index}
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: index < value ? INTENSITY_COLORS[value] : 'rgba(255,255,255,0.15)' }}
      />
    ))}
  </span>
);

const SegmentGallery: React.FC = () => {
  const [phone, setPhone] = useState(() => new URLSearchParams(window.location.search).get('device') === 'phone');
  const [showSpacing, setShowSpacing] = useState(false);
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('segment') ?? '');
  const [mirrored, setMirrored] = useState(false);
  const [showReach, setShowReach] = useState(true);
  const [variant, setVariant] = useState(0);
  const [seed, setSeed] = useState(1);
  const plan = useMemo(() => planSong(seed, phone ? PHONE_ENTITY_SCALE : 1), [seed, phone]);

  const sectionsWithSegments = SONG_SECTIONS.map((section) => ({
    section,
    segments: plan.filter((planned) => planned.section === section.name),
  }));

  return (
    <main
      // The game locks body scrolling, so this page scrolls itself.
      className="h-[100dvh] overflow-y-auto bg-[#0b1430] px-4 py-6 text-white sm:px-8"
      style={{ fontFamily: 'NJZPixelZh, NJZPixelEn, monospace', fontSynthesis: 'none' }}
    >
      <header className="mx-auto max-w-6xl">
        <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">NJZ FLIGHT · 开发预览</div>
        <h1 className="mt-2 text-2xl text-white sm:text-3xl">关卡片段目录（{SEGMENTS.length} 个）</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">
          每个片段是 1 或 2 个小节（约 2.2 秒 / 小节，BGM 109 BPM）。竖线是拍子，亮竖线是小节线；绿色区域是"不射击也能飞到"的范围，由求解器自动验证。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            布局
            <select aria-label="布局版本" value={phone ? 'phone' : 'original'} onChange={event => setPhone(event.target.value === 'phone')} className="bg-[#26345b] px-3 py-2">
              <option value="original">原版 · 电脑 / Pad</option>
              <option value="phone">手机 · 1.5 倍实体</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showSpacing} onChange={event => setShowSpacing(event.target.checked)} />
            显示物件占用范围和路线
          </label>
          <select aria-label="选择片段" value={selected} onChange={event => setSelected(event.target.value)} className="bg-[#26345b] px-3 py-2">
            <option value="">全部片段</option>
            {SEGMENTS.map(segment => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
            <input type="checkbox" checked={showReach} onChange={(event) => setShowReach(event.target.checked)} />
            显示可通行区域
          </label>
          <label className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
            <input type="checkbox" checked={mirrored} onChange={(event) => setMirrored(event.target.checked)} />
            上下镜像（可镜像的片段）
          </label>
          <button
            type="button"
            onClick={() => setVariant((value) => value + 1)}
            className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20"
            aria-label="换一组随机变体"
            title="换一组随机变体"
          >
            <RefreshCw className="h-4 w-4" />
            换一组变体
          </button>
          <span className="flex flex-wrap items-center gap-3 text-xs text-white/70">
            {(Object.keys(ROLE_COLORS) as CoinRole[]).map((role) => (
              <span key={role} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: ROLE_COLORS[role] }} />
                {ROLE_LABELS[role]}
              </span>
            ))}
          </span>
        </div>
      </header>

      <section className="mx-auto mt-8 max-w-6xl rounded-2xl bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg">整局编排预览（随机种子 {seed}）</h2>
          <button
            type="button"
            onClick={() => setSeed((value) => value + 1)}
            className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-sky-50"
            aria-label="重新编排一局"
            title="重新编排一局"
          >
            <RefreshCw className="h-4 w-4" />
            重新编排
          </button>
        </div>
        <p className="mt-1 text-xs text-white/60">颜色表示强度：绿 = 休息，蓝 = 简单，橙 = 中等，红 = 高潮。每个格子宽度 = 小节数。</p>
        <div className="mt-3 space-y-2">
          {sectionsWithSegments.map(({ section, segments }) => (
            <div key={section.name} className="flex items-stretch gap-2">
              <div className="w-20 shrink-0 pt-1 text-xs text-white/70">
                {section.name}
                <div className="text-white/40">{section.bars} 小节</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {segments.map((planned) => (
                  <div
                    key={`${planned.startBar}-${planned.segment.id}`}
                    className="truncate rounded px-1.5 py-1 text-[11px] text-slate-950"
                    style={{ width: `${planned.segment.bars * 4.2}rem`, background: INTENSITY_COLORS[planned.segment.intensity] }}
                    title={`第 ${planned.startBar + 1} 小节 · ${planned.segment.name}${planned.mirrored ? '（镜像）' : ''}`}
                  >
                    {planned.segment.name}
                    {planned.mirrored ? ' ↕' : ''}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {THEME_ORDER.filter(theme => !selected || SEGMENTS.some(s => s.theme === theme && s.id === selected)).map((theme) => (
        <section key={theme} className="mx-auto mt-10 max-w-6xl">
          <h2 className="border-b border-white/10 pb-2 text-lg">
            {THEME_LABELS[theme]}
            <span className="ml-2 text-sm text-white/50">{SEGMENTS.filter((segment) => segment.theme === theme).length} 个</span>
          </h2>
          <div className="mt-4 flex flex-wrap gap-5">
            {SEGMENTS.filter((segment) => segment.theme === theme && (!selected || segment.id === selected)).map((segment) => (
              <article key={segment.id} className="max-w-full rounded-xl bg-white/5 p-3" style={{ width: segmentWidth(segment, phone ? PHONE_ENTITY_SCALE : 1) * PREVIEW_SCALE + 24 }}>
                <SegmentCanvas
                  segment={segment}
                  mirrored={mirrored && segment.mirror}
                  variant={variant}
                  showReach={showReach}
                  phone={phone}
                  showSpacing={showSpacing}
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-base text-white">{segment.name}</span>
                  <IntensityDots value={segment.intensity} />
                  <span className="text-xs text-white/55">{TIER_LABELS[segment.tier]}</span>
                  <span className="text-xs text-white/55">{segment.bars} 小节</span>
                  {segment.mirror && <span className="text-xs text-white/55">可镜像</span>}
                  {segment.scripted && <span className="text-xs text-white/55">固定出场</span>}
                </div>
                <div className="font-pixel-en mt-0.5 text-[11px] text-white/35">{segment.id}</div>
                <p className="mt-1 text-xs leading-5 text-white/75">{segment.intent}</p>
                {segment.requires && (
                  <p className="mt-1 text-[11px] text-white/45">需要先出现过：{segment.requires.map((item) => THEME_LABELS[item]).join('、')}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
};

export default SegmentGallery;
