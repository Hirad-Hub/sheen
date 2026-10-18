import { useEffect, useMemo, useRef, useState } from 'react'
import Waveform from './Waveform'

interface Props { original: Blob; mastered: Blob; peaksBefore: Float32Array; peaksAfter: Float32Array }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function Player({ original, mastered, peaksBefore, peaksAfter }: Props) {
  const urls = useMemo(() => ({ a: URL.createObjectURL(original), b: URL.createObjectURL(mastered) }), [original, mastered])
  useEffect(() => () => { URL.revokeObjectURL(urls.a); URL.revokeObjectURL(urls.b) }, [urls])
  const a = useRef<HTMLAudioElement>(null), b = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState<'a' | 'b'>('b')
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0), [dur, setDur] = useState(0)
  const active = () => (src === 'a' ? a.current : b.current)

  useEffect(() => {
    let raf = 0
    const tick = () => { const el = active(); if (el) setT(el.currentTime); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  const switchTo = (s: 'a' | 'b') => {
    if (s === src) return
    const from = active(), to = s === 'a' ? a.current : b.current
    if (!from || !to) return
    to.currentTime = from.currentTime
    if (playing) { from.pause(); void to.play() }
    setSrc(s)
  }
  const toggle = () => {
    const el = active()
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) } else { void el.play(); setPlaying(true) }
  }
  const seek = (f: number) => { const el = active(); if (el && dur) el.currentTime = f * dur }
  const p = dur ? t / dur : 0

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <audio ref={a} src={urls.a} preload="auto" onEnded={() => setPlaying(false)} />
      <audio ref={b} src={urls.b} preload="auto" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onEnded={() => setPlaying(false)} />
      <div className="flex items-center gap-4">
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-ink transition hover:scale-105">
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="flex rounded-full border border-line bg-ink p-1 text-sm">
          {(['a', 'b'] as const).map((s) => (
            <button key={s} onClick={() => switchTo(s)} className={`rounded-full px-4 py-1.5 transition ${src === s ? (s === 'b' ? 'bg-glow text-ink font-medium' : 'bg-white/90 text-ink font-medium') : 'text-mute hover:text-white'}`}>
              {s === 'a' ? 'Original' : 'Mastered'}
            </button>
          ))}
        </div>
        <span className="num ml-auto text-sm text-mute">{fmt(t)} / {fmt(dur)}</span>
      </div>
      <div className="mt-5 space-y-3">
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-mute">Original</div>
          <Waveform peaks={peaksBefore} color="#d4d4d8" progress={p} dim={src !== 'a'} onSeek={seek} height={52} />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-glow-soft">Mastered</div>
          <Waveform peaks={peaksAfter} color="#ff8a3d" progress={p} dim={src !== 'b'} onSeek={seek} height={52} />
        </div>
      </div>
      <p className="mt-4 text-xs text-mute">Switch between Original and Mastered while playing — position is kept so you hear the difference instantly.</p>
    </div>
  )
}
