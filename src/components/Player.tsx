import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Waveform from './Waveform'

interface Props { original: Blob | string; mastered: Blob | string; peaksBefore: Float32Array; peaksAfter: Float32Array; onStartOver: () => void; headerAction?: ReactNode; children?: ReactNode }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function Player({ original, mastered, peaksBefore, peaksAfter, onStartOver, headerAction, children }: Props) {
  const urls = useMemo(() => ({
    a: typeof original === 'string' ? { src: original, owned: false } : { src: URL.createObjectURL(original), owned: true },
    b: typeof mastered === 'string' ? { src: mastered, owned: false } : { src: URL.createObjectURL(mastered), owned: true },
  }), [original, mastered])
  useEffect(() => () => {
    if (urls.a.owned) URL.revokeObjectURL(urls.a.src)
    if (urls.b.owned) URL.revokeObjectURL(urls.b.src)
  }, [urls])
  const a = useRef<HTMLAudioElement>(null), b = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState<'a' | 'b'>('b')
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0), [dur, setDur] = useState(0)
  const fadeRef = useRef<{ frame: number; from: HTMLAudioElement; to: HTMLAudioElement } | null>(null)
  const active = () => (src === 'a' ? a.current : b.current)

  useEffect(() => {
    const el = active()
    if (el && el.readyState >= 1) setDur(el.duration)
  }, [src])

  useEffect(() => {
    let raf = 0
    const tick = () => { const el = active(); if (el) setT(el.currentTime); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  const changeSource = async (s: 'a' | 'b', shouldPlay: boolean) => {
    if (fadeRef.current) {
      cancelAnimationFrame(fadeRef.current.frame)
      fadeRef.current.from.pause()
      fadeRef.current.from.volume = 1
      fadeRef.current.to.volume = 1
      fadeRef.current = null
    }
    const from = active()
    const target = s === 'a' ? a.current : b.current
    if (!target) return
    const currentTime = from?.currentTime ?? t
    if (from === target) {
      if (!shouldPlay) { target.pause(); setPlaying(false); return }
      setPlaying(true)
      try { await target.play() } catch { setPlaying(false) }
      return
    }

    target.currentTime = Number.isFinite(target.duration) && target.duration > 0
      ? Math.min(currentTime, target.duration)
      : currentTime
    if (!shouldPlay) {
      from?.pause()
      target.volume = 1
      setSrc(s)
      setPlaying(false)
      return
    }

    const crossfade = Boolean(from && playing)
    if (crossfade) target.volume = 0
    try {
      await target.play()
    } catch {
      target.volume = 1
      if (!from) setPlaying(false)
      return
    }

    setSrc(s)
    setPlaying(true)
    if (!crossfade || !from) {
      from?.pause()
      target.volume = 1
      return
    }

    const startedAt = performance.now()
    const fadeDuration = 60
    const fade = (now: number) => {
      const amount = Math.min(1, (now - startedAt) / fadeDuration)
      from.volume = 1 - amount
      target.volume = amount
      if (amount < 1) {
        fadeRef.current = { frame: requestAnimationFrame(fade), from, to: target }
      }
      else {
        from.pause()
        from.volume = 1
        target.volume = 1
        fadeRef.current = null
      }
    }
    fadeRef.current = { frame: requestAnimationFrame(fade), from, to: target }
  }
  const switchTo = (s: 'a' | 'b') => { if (s !== src) void changeSource(s, playing) }
  const toggle = () => {
    const el = active()
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) } else { void el.play(); setPlaying(true) }
  }
  const seek = (f: number) => { const el = active(); if (el && dur) el.currentTime = f * dur }
  const p = dur ? t / dur : 0

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <audio ref={a} src={urls.a.src} preload="auto" onLoadedMetadata={(e) => { if (src === 'a') setDur(e.currentTarget.duration) }} onEnded={() => setPlaying(false)} />
      <audio ref={b} src={urls.b.src} preload="auto" onLoadedMetadata={(e) => { if (src === 'b') setDur(e.currentTarget.duration) }} onEnded={() => setPlaying(false)} />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="num text-left text-[15px] text-mute">{fmt(t)} / {fmt(dur)}</span>
        <div className="flex items-center justify-center gap-4">
          <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:scale-105 hover:bg-white/15">
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>
          )}
          </button>
          <div className="flex rounded-full border border-line bg-ink p-1 text-[15px]">
          {(['a', 'b'] as const).map((s) => (
            <button key={s} onClick={() => switchTo(s)} className={`rounded-full px-4 py-1.5 transition ${src === s ? (s === 'b' ? 'bg-glow text-white font-medium' : 'bg-white/90 text-ink font-medium') : 'text-mute hover:text-white'}`}>
              {s === 'a' ? 'Original' : 'Mastered'}
            </button>
          ))}
          </div>
        </div>
        <div className="justify-self-end">{headerAction ?? <button onClick={onStartOver} className="rounded-full border border-line px-4 py-2 text-[15px] text-mute transition hover:border-white/20 hover:text-white">Start over</button>}</div>
      </div>
      <div className="mt-5 space-y-3">
        <div>
          <div className="mb-1.5 text-[12px] uppercase tracking-[0.14em] text-mute">Original</div>
          <Waveform peaks={peaksBefore} color="#ffffff" progress={src === 'a' ? p : 0} dim={src !== 'a'} onSeek={() => void changeSource('a', true)} height={80} />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] uppercase tracking-[0.14em] text-glow-soft">Mastered</div>
          <Waveform peaks={peaksAfter} color="#ff8b41" progress={src === 'b' ? p : 0} dim={src !== 'b'} onSeek={() => void changeSource('b', true)} height={80} />
        </div>
      </div>
      <p className="mt-4 text-[13px] text-mute">Switch between Original and Mastered while playing.</p>
      {children}
    </div>
  )
}
