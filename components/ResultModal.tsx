import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeycapButton, PixelIcon } from './PixelUI';
import { drawResultModal, measureResultModalTitle, prepareResultCard, resultCardBlob, RESULT_MODAL_CONTENT, RESULT_MODAL_HEIGHT, RESULT_MODAL_WIDTH } from './resultCardArt';
import { resultTallyAt, resultTitle, type ResultRecord } from './resultTally';

interface ResultModalProps extends ResultRecord {
  onRetry: () => void;
  onHome: () => void;
  onTick: (progress: number) => void;
  onDone: () => void;
  /** Preview replays the exact modal, including its entrance and tally. */
  onReplay?: () => void;
}

/** Align painted glyphs, rather than the font line box or SVG's empty margins. */
function ResultHomeButton({ ready, failed, onClick }: { ready: boolean; failed: boolean; onClick: () => void }) {
  const label = '回首页';
  const height = 30, gap = 6;
  const ink = useMemo(() => {
    if (!ready) return null;
    const context = document.createElement('canvas').getContext('2d')!;
    const title = measureResultModalTitle(context, failed);
    context.font = '12px NJZPixelZh';
    const metrics = context.measureText(label);
    return {
      width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      left: metrics.actualBoundingBoxLeft,
      baseline: height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
      top: title.centerY - height / 2,
    };
  }, [ready, failed]);
  const iconSize = ink?.height ?? 12;
  const width = iconSize + gap + (ink?.width ?? 36);
  return (
    <button type="button" onClick={onClick} className="landscape-result-home" aria-label={label} title={label}
      style={{ top: ink?.top, right: RESULT_MODAL_WIDTH - RESULT_MODAL_CONTENT.right, width, visibility: ink ? 'visible' : 'hidden' }}>
      <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="result-home-art">
        <g transform={`translate(0 ${(height - iconSize) / 2})`}><PixelIcon name="home" size={iconSize} trim /></g>
        <text x={iconSize + gap + (ink?.left ?? 0)} y={ink?.baseline ?? 0} fontSize={12} fill="currentColor">{label}</text>
      </svg>
    </button>
  );
}

const ResultModal: React.FC<ResultModalProps> = (props) => {
  const { failed, leadMember, score, sticks, pigs, progress, onRetry, onHome, onReplay } = props;
  const record = { failed, leadMember, score, sticks, pigs, progress };
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof prepareResultCard>> | null>(null);
  const [error, setError] = useState('');
  const [shareToast, setShareToast] = useState<{ message: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [values, setValues] = useState(() => resultTallyAt(record, 0));
  const shareFile = useRef<File | null>(null);

  useEffect(() => {
    if (!shareToast) return;
    const timer = window.setTimeout(() => setShareToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [shareToast]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current!;
    const update = () => {
      const style = getComputedStyle(overlay);
      setSize({
        width: overlay.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: overlay.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(overlay);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void prepareResultCard().then(loaded => { if (!cancelled) setAssets(loaded); }).catch(() => {
      if (!cancelled) setError('图片加载失败，请刷新重试');
    });
    void resultCardBlob(record).then(blob => {
      if (!cancelled) shareFile.current = new File([blob], `飞越冬夜-${failed ? '再试一次' : '飞越成功'}.png`, { type: 'image/png' });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [failed, leadMember, score, sticks, pigs, progress]);

  useEffect(() => {
    if (!assets || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let frame = 0, start = -1, lastTick = -Infinity, lastReadout = -Infinity, done = false, readoutDone = false;
    const update = (now: number) => {
      if (start < 0) start = now;
      const elapsed = now - start;
      const tally = resultTallyAt(record, elapsed);
      drawResultModal(canvas, assets, record, tally, elapsed);
      // Sound uses the very same clock and starts on the first visible frame.
      if (!tally.landed && now - lastTick >= 55) {
        callbacks.current.onTick(tally.progress);
        lastTick = now;
      }
      if (tally.landed && !done) {
        done = true;
        callbacks.current.onDone();
      }
      if (!readoutDone && (now - lastReadout >= 70 || tally.landed)) {
        setValues(tally);
        lastReadout = now;
        readoutDone = tally.landed;
      }
      frame = requestAnimationFrame(update);
    };
    drawResultModal(canvas, assets, record, resultTallyAt(record, 0), 0);
    frame = requestAnimationFrame(update);
    overlayRef.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [assets, failed, leadMember, score, sticks, pigs, progress]);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    setShareToast(null);
    try {
      const file = shareFile.current ?? new File([await resultCardBlob(record)], '飞越冬夜.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '飞越冬夜', text: `${resultTitle(failed)} · 总分 ${score}` });
      } else {
        const url = URL.createObjectURL(file), anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.name; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setShareToast({ message: '已保存' });
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setShareToast({ message: '保存失败，请重试' });
    } finally { setSharing(false); }
  };

  const fit = Math.max(.1, Math.min(1.16, size.width / RESULT_MODAL_WIDTH, size.height / RESULT_MODAL_HEIGHT));
  return (
    <div ref={overlayRef} tabIndex={-1} className="landscape-result-backdrop absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label={failed ? '本局结算：再试一次' : '本局结算：飞越成功'}>
      <div className="landscape-result-frame" style={{ width: RESULT_MODAL_WIDTH * fit, height: RESULT_MODAL_HEIGHT * fit }}>
        <div className="landscape-result-fit" style={{ transform: `scale(${fit})` }}>
          <div className={`landscape-result-card${assets ? ' result-landscape-enter' : ''}`}>
            <canvas ref={canvasRef} width={RESULT_MODAL_WIDTH * 2} height={RESULT_MODAL_HEIGHT * 2} role="img" aria-label={`${resultTitle(failed)}，总分 ${score}，应援棒 ${sticks}，暴击方猪 ${pigs}，歌曲完成 ${Math.round(progress * 100)}%`} />
            {!assets && <div className="result-loading">{error || '正在展开战报…'}</div>}
            <ResultHomeButton ready={!!assets} failed={failed} onClick={onHome} />
            <div className="landscape-result-actions" style={{ top: RESULT_MODAL_CONTENT.actionsTop }}>
              <KeycapButton variant="outline" snow={false} width={184} height={40} onClick={onRetry} aria-label="再来一次" title="再来一次" className="text-sm">
                <PixelIcon name="restart" size={14} />再来一次
              </KeycapButton>
              <KeycapButton snow={false} width={184} height={40} onClick={share} disabled={sharing || !assets} aria-label="分享战报" title="分享战报" className="text-sm">
                <PixelIcon name="share" size={14} />{sharing ? '生成中…' : '分享战报'}
              </KeycapButton>
            </div>
            {onReplay && <button type="button" onClick={onReplay} className="landscape-result-replay" aria-label="重播动效" title="重播动效"><PixelIcon name="playSolid" size={12} />重播动效</button>}
          </div>
        </div>
      </div>
      <div className="result-toast-layer" role="status" aria-live="polite" aria-atomic="true">
        {shareToast && <div className="result-toast">{shareToast.message}</div>}
      </div>
      <dl className="sr-only" aria-label="当前计分" data-tally-state={values.landed ? 'landed' : 'rolling'}>
        <dt>总分</dt><dd data-result-value="score">{values.score}</dd>
        <dt>应援棒</dt><dd data-result-value="sticks">{values.sticks}</dd>
        <dt>暴击方猪</dt><dd data-result-value="pigs">{values.pigs}</dd>
        <dt>歌曲完成</dt><dd data-result-value="percent">{values.percent}%</dd>
      </dl>
    </div>
  );
};

export default ResultModal;
