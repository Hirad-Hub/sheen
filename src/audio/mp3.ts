/** MP3 encoding (LAME via lamejs). Encodes the final master exactly once per delivery. */
import { Mp3Encoder } from '@breezystack/lamejs'

const MP3_RATES = [48000, 44100, 32000]

/** Windowed-sinc resampler, used only when the source rate is not MP3-legal (e.g. 96 kHz). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to, n = Math.floor(x.length / ratio)
  const out = new Float32Array(n)
  const cutoff = Math.min(1, to / from) * 0.95, half = 32
  for (let i = 0; i < n; i++) {
    const t = i * ratio, c = Math.floor(t)
    let s = 0, ws = 0
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue
      const d = t - k
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d * cutoff) / (Math.PI * d * cutoff)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / half)
      s += x[k] * sinc * w; ws += sinc * w
    }
    out[i] = s / ws
  }
  return out
}

export function mp3Rate(sr: number) {
  return MP3_RATES.includes(sr) ? sr : sr % 44100 === 0 ? 44100 : 48000
}

export function encodeMp3(ch: Float32Array[], sr: number, kbps: number, trimDb = 0): Uint8Array {
  const rate = mp3Rate(sr)
  const src = rate === sr ? ch : ch.map((c) => resample(c, sr, rate))
  const g = Math.pow(10, trimDb / 20)
  const toI16 = (c: Float32Array) => {
    const o = new Int16Array(c.length)
    for (let i = 0; i < c.length; i++) {
      const d = Math.random() - Math.random()
      o[i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * g * 32767 + d)))
    }
    return o
  }
  const pcm = src.map(toI16)
  const enc = new Mp3Encoder(pcm.length, rate, kbps)
  const parts: Uint8Array[] = []
  const block = 1152 * 8
  for (let i = 0; i < pcm[0].length; i += block) {
    const l = pcm[0].subarray(i, i + block)
    const b = pcm.length > 1 ? enc.encodeBuffer(l, pcm[1].subarray(i, i + block)) : enc.encodeBuffer(l)
    if (b.length) parts.push(new Uint8Array(b))
  }
  const f = enc.flush()
  if (f.length) parts.push(new Uint8Array(f))
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
