import React, { useCallback, useEffect, useRef, useState } from 'react';
import ResultModal from './ResultModal';
import { KeycapButton, PixelIcon } from './PixelUI';
import { prepareResultCard } from './resultCardArt';
import { readPhoneDevice } from './displayProfile';
import bottom from '../NJZPowerpuffGirls/bottom1.webp';
import middle from '../NJZPowerpuffGirls/middle1.webp';
import top from '../NJZPowerpuffGirls/top.webp';

const phonePreview = import.meta.env.DEV && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('device') === 'phone';

/** A gesture starts sound and the real modal together; no gameplay or BGM. */
const ResultPreview: React.FC<{ failed: boolean }> = ({ failed }) => {
  const [isPhone, setIsPhone] = useState(() => phonePreview || readPhoneDevice());
  useEffect(() => {
    const updateDevice = () => setIsPhone(phonePreview || readPhoneDevice());
    const pointer = window.matchMedia('(pointer: coarse)');
    window.addEventListener('resize', updateDevice);
    pointer.addEventListener('change', updateDevice);
    return () => {
      window.removeEventListener('resize', updateDevice);
      pointer.removeEventListener('change', updateDevice);
    };
  }, []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [take, setTake] = useState(0);
  const [muted, setMuted] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const voices = useRef(new Set<OscillatorNode>());
  useEffect(() => {
    void prepareResultCard().then(() => setReady(true)).catch(() => setError('图片加载失败，请刷新重试'));
    return () => { void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);
  const stopVoices = () => {
    voices.current.forEach(voice => { try { voice.stop(); } catch {} });
    voices.current.clear();
  };
  const play = async () => {
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context) {
      try {
        audio.current ??= new Context();
        if (audio.current.state === 'suspended') await audio.current.resume();
      } catch { /* Visual preview still works when audio is unavailable. */ }
    }
    stopVoices();
    setTake(value => value + 1);
  };
  const tones = useCallback((notes: number[], interval: number, volume: number) => {
    const context = audio.current;
    if (!context || context.state !== 'running' || mutedRef.current) return;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = context.currentTime + index * interval;
      oscillator.type = 'square'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, at + interval * 1.8);
      oscillator.connect(gain); gain.connect(context.destination);
      voices.current.add(oscillator);
      oscillator.onended = () => { voices.current.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + interval * 2);
    });
  }, []);
  const onTick = useCallback((progress: number) => tones([520 + progress * 780], .028, .045), [tones]);
  const onDone = useCallback(() => tones([783.99, 1046.5, 1318.5, 1568, 2093], .07, .08), [tones]);
  return (
    <main className={`game-root result-preview-root${isPhone ? ' phone-device' : ''}${phonePreview ? ' phone-preview' : ''}`}>
      <div className="result-preview-scene" aria-hidden="true">
        <img src={bottom} className="preview-far" alt="" /><img src={middle} className="preview-middle" alt="" /><img src={top} className="preview-front" alt="" />
      </div>
      <div className="result-preview-toolbar">
        <span>{take === 0 ? failed ? '生命耗尽 · 结算预览' : '抵达终点 · 结算预览' : ''}</span>
        <button type="button" onClick={() => { mutedRef.current = !muted; setMuted(!muted); if (!muted) stopVoices(); }} aria-label={muted ? '开启预览音效' : '关闭预览音效'} title={muted ? '开启预览音效' : '关闭预览音效'}><PixelIcon name="sound" size={20} slashed={muted} /></button>
      </div>
      {take === 0 ? <div className="result-preview-start">
        <h1>{failed ? '再试一次 终将抵达' : '飞越成功！'}</h1>
        <p>点击播放，体验结算动效和音效</p>
        <KeycapButton width={184} height={48} snow={false} onClick={play} disabled={!ready} aria-label="播放结算动效" title="播放结算动效"><PixelIcon name="playSolid" size={18} />{ready ? '播放动效' : error || '加载中…'}</KeycapButton>
      </div> : <ResultModal key={take}
        failed={failed} leadMember={1} score={failed ? 1863 : 4860} sticks={failed ? 155 : 286} pigs={failed ? 10 : 24} progress={failed ? .23 : 1}
        onRetry={play} onHome={() => { window.location.href = '/'; }} onReplay={play} onTick={onTick} onDone={onDone}
      />}
    </main>
  );
};

export default ResultPreview;
