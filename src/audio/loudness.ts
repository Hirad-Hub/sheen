/**
 * ITU-R BS.1770-4 / EBU R128 measurements: K-weighting (coefficients derived
 * for any sample rate, as in libebur128), gated integrated loudness, LRA
 * (EBU Tech 3342) and true peak via 4x polyphase oversampling.
 */
import { process, type Coefs } from './biquad'

export function kWeightCoefs(fs: number): [Coefs, Coefs] {
  let f0 = 1681.974450955533, Q = 0.7071752369554196
  const G = 3.999843853973347
  let K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const s1: Coefs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0,
  }
  f0 = 38.13547087602444; Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / fs)
  a0 = 1 + K / Q + K * K
  const s2: Coefs = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  return [s1, s2]
}

export interface LoudnessResult { integrated: number; shortTerm: number[]; lra: number }

export function measureLoudness(ch: Float32Array[], fs: number): LoudnessResult {
  const [s1, s2] = kWeightCoefs(fs)
  const n = ch[0].length
  const step = Math.round(fs * 0.1) // 100 ms hops → 400 ms blocks with 75 % overlap
  const hops = Math.floor(n / step)
  const hopPow = new Float64Array(hops)
  for (const c of ch) {
    const k = process(process(c, s1, new Float32Array(n)), s2)
    for (let h = 0; h < hops; h++) {
      let s = 0
      const o = h * step
      for (let i = 0; i < step; i++) s += k[o + i] * k[o + i]
      hopPow[h] += s / step
    }
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p)
  const blocks: number[] = []
  for (let h = 0; h + 4 <= hops; h++) blocks.push((hopPow[h] + hopPow[h + 1] + hopPow[h + 2] + hopPow[h + 3]) / 4)
  const abs = blocks.filter((p) => lk(p) > -70)
  let integrated = -Infinity
  if (abs.length) {
    const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
    const g = abs.filter((p) => lk(p) > rel)
    if (g.length) integrated = lk(g.reduce((a, b) => a + b, 0) / g.length)
  }
  const shortTerm: number[] = []
  for (let h = 0; h + 30 <= hops; h += 10) {
    let s = 0
    for (let i = 0; i < 30; i++) s += hopPow[h + i]
    shortTerm.push(lk(s / 30))
  }
  const st = shortTerm.filter((v) => v > -70)
  let lra = 0
  if (st.length > 2) {
    const m = 10 * Math.log10(st.reduce((a, v) => a + Math.pow(10, v / 10), 0) / st.length) - 20
    const g = st.filter((v) => v > m).sort((a, b) => a - b)
    if (g.length > 2) lra = g[Math.min(g.length - 1, Math.floor(g.length * 0.95))] - g[Math.floor(g.length * 0.1)]
  }
  return { integrated, shortTerm, lra }
}

// True peak: 4x oversampling, 48-tap Blackman-windowed sinc split into 4 phases of 12 taps.
const TAPS = 12
const PHASES = 4
const POLY: Float64Array[] = (() => {
  const total = TAPS * PHASES
  const h = new Float64Array(total)
  const mid = (total - 1) / 2
  for (let i = 0; i < total; i++) {
    const t = (i - mid) / PHASES
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (total - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (total - 1))
    h[i] = sinc * w
  }
  const phases: Float64Array[] = []
  for (let p = 0; p < PHASES; p++) {
    const f = new Float64Array(TAPS)
    let sum = 0
    for (let k = 0; k < TAPS; k++) { f[k] = h[k * PHASES + p]; sum += f[k] }
    for (let k = 0; k < TAPS; k++) f[k] /= sum
    phases.push(f)
  }
  return phases
})()

/** Per-sample oversampled absolute peak envelope. If `out` is given, takes the max into it (stereo link). */
export function truePeakEnvelope(x: Float32Array, out?: Float32Array): Float32Array {
  const n = x.length
  const env = out ?? new Float32Array(n)
  const half = TAPS / 2
  for (let i = 0; i < n; i++) {
    let m = Math.abs(x[i])
    if (i >= half && i < n - half) {
      const o = i - half + 1
      for (let p = 0; p < PHASES; p++) {
        const f = POLY[p]
        let s = 0
        for (let k = 0; k < TAPS; k++) s += f[k] * x[o + k]
        const a = s < 0 ? -s : s
        if (a > m) m = a
      }
    }
    env[i] = out ? Math.max(env[i], m) : m
  }
  return env
}

export function truePeak(ch: Float32Array[]): number {
  let m = 0
  for (const c of ch) {
    const e = truePeakEnvelope(c)
    for (let i = 0; i < e.length; i++) if (e[i] > m) m = e[i]
  }
  return m
}

export const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity)
export const undb = (d: number) => Math.pow(10, d / 20)
