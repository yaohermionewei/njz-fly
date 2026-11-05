import React, { useEffect, useRef, useState } from 'react';
import { KeycapButton, PixelButton, PixelFrame, PixelIcon } from './PixelUI';
import rewardCode from '../assets/wechat-reward-code.webp';

/** Reuses the author's original WeChat reward code, without altering its pixels. */
export default function SupportPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<File | null>(null);
  const mountedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      // Keep the home screen and game shortcuts quiet while the panel is open.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKeyDown, true);
      previous?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const prepareDownload = () => {
    setLoaded(true);
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    // Export a widely supported PNG for saving to a phone's photo library.
    canvas.toBlob(blob => {
      if (blob) fileRef.current = new File([blob], '飞越冬夜-微信赞赏码.png', { type: 'image/png' });
    }, 'image/png');
  };

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    setNote('');
    try {
      const file = fileRef.current;
      const touchDevice = navigator.maxTouchPoints > 0;
      if (file && touchDevice && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
          // Some browsers advertise file sharing but reject it at runtime.
        }
      }
      const url = file ? URL.createObjectURL(file) : rewardCode;
      const link = document.createElement('a');
      link.href = url;
      link.download = file?.name ?? '飞越冬夜-微信赞赏码.webp';
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (file) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (mountedRef.current) setNote('请长按赞赏码，或右键保存图片。');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div className="support-backdrop absolute inset-0 z-50 flex items-center justify-center bg-[#060a22]/75" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="support-title" aria-describedby="support-description" className="support-card" onClick={event => event.stopPropagation()}>
        <PixelFrame tone="panel" units={[340, 164]} />
        <PixelButton onClick={onClose} className="support-close h-11 w-11 text-[#dce7ff]" aria-label="关闭赞赏" title="关闭赞赏">
          <PixelIcon name="close" size={18} />
        </PixelButton>
        <div className="support-body">
          <div className="support-code-column">
            <div className="support-code-board">
              <div className="support-code-face">
                {!loaded && <div className="support-code-status" role="status">{failed ? '赞赏码加载失败，请关闭后重试' : '赞赏码加载中…'}</div>}
                <img ref={imageRef} src={rewardCode} alt="作者的微信赞赏码，可长按或右键保存" className="support-code" style={{ opacity: loaded ? 1 : 0 }} onLoad={prepareDownload} onError={() => setFailed(true)} />
              </div>
            </div>
          </div>
          <div className="support-copy">
            <h2 id="support-title"><span>如果你喜欢飞越冬夜</span><span>欢迎给我打赏</span></h2>
            <p id="support-description">微信扫码打赏，也可以留言提想法</p>
            <KeycapButton snow={false} width={184} height={44} onClick={save} disabled={!loaded || saving} aria-label="保存赞赏码" title="保存赞赏码" className="support-save text-[15px]">
              <PixelIcon name="download" size={16} />{saving ? '正在打开…' : '保存赞赏码'}
            </KeycapButton>
            {note && <p className="support-note" role="status" aria-live="polite">{note}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
