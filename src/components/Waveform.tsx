import { useEffect, useRef } from 'react'

interface Props { peaks: Float32Array; color: string; progress: number; dim?: boolean; onSeek?: (f: number) => void; height?: number }

export default function Waveform({ peaks, color, progress, dim, onSeek, height = 64 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    c.width = w * dpr; c.height = h * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const bars = Math.floor(w / 3)
    for (let i = 0; i < bars; i++) {
      const a = Math.floor((i / bars) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / bars) * peaks.length))
      let m = 0
      for (let k = a; k < b; k++) if (peaks[k] > m) m = peaks[k]
      const bh = Math.max(1, m * h)
      ctx.fillStyle = i / bars <= progress ? color : dim ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.22)'
      ctx.fillRect(i * 3, (h - bh) / 2, 2, bh)
    }
  }, [peaks, color, progress, dim])
  return (
    <canvas
      ref={ref}
      style={{ height }}
      className={`w-full block ${onSeek ? 'cursor-pointer' : ''} transition-opacity ${dim ? 'opacity-50' : ''}`}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek?.((e.clientX - r.left) / r.width) }}
    />
  )
}
