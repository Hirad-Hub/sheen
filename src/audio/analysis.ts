/** Stage 1 & 7: signal measurements used for decisions and verification. */
import { lowpass, lr4 } from './biquad'
import { averageSpectrum } from './fft'
import { db, measureLoudness, truePeak } from './loudness'
import { ENGINE } from './config'

export interface Tonal {
  sub: number; bass: number; lowMid: number; mid: number; harsh: number; air: number
  kickHz: number
}

export interface Metrics {
  durationSec: number
  sampleRate: number
  channels: number
  lufs: number
  lra: number
  rmsDb: number
  samplePeakDb: number
  truePeakDb: number
  crestDb: number
  plrDb: number
  widthPct: number
  correlation: number
  lowCorrelation: number
  lowSideDb: number
  dcOffset: number
  clipRuns: number
  invalidSamples: number
  silent: boolean
  tonal: Tonal
}

const SPEC = 8192

function bandLevel(spec: Float64Array, fs: number, lo: number, hi: number) {
  const bw = fs / SPEC
  let s = 0
  for (let k = Math.max(1, Math.floor(lo / bw)); k <= Math.min(spec.length - 1, Math.ceil(hi / bw)); k++) s += spec[k]
  return 10 * Math.log10(s / Math.log2(hi / lo) + 1e-30)
}

export function tonal(ch: Float32Array[], fs: number): Tonal {
  const spec = averageSpectrum(ch, SPEC)
  const ref = bandLevel(spec, fs, 1000, 4000)
  const rel = (lo: number, hi: number) => bandLevel(spec, fs, lo, Math.min(hi, fs / 2 - 1)) - ref
  const bw = fs / SPEC
  const [klo, khi] = ENGINE.kickSearchHz
  let best = -1, kickHz: number = ENGINE.kickDefaultHz
  for (let k = Math.ceil(klo / bw); k <= Math.floor(khi / bw); k++) if (spec[k] > best) { best = spec[k]; kickHz = k * bw }
  return {
    sub: rel(20, 40), bass: rel(40, 120), lowMid: rel(200, 500), mid: 0,
    harsh: rel(5000, 8000), air: fs > 24000 ? rel(10000, 16000) : -60, kickHz,
  }
}

function corr(a: Float32Array, b: Float32Array) {
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 1
}

export function analyze(ch: Float32Array[], fs: number): Metrics {
  const n = ch[0].length
  let invalid = 0, peak = 0, pow = 0, dc = 0, clipRuns = 0
  for (const c of ch) {
    let sum = 0, run = 0
    for (let i = 0; i < n; i++) {
      const v = c[i]
      if (!Number.isFinite(v)) { invalid++; c[i] = 0; continue }
      const a = Math.abs(v)
      if (a > peak) peak = a
      pow += v * v; sum += v
      if (a >= 0.999) { run++; if (run === ENGINE.verify.clipRunSamples) clipRuns++ } else run = 0
    }
    dc = Math.max(dc, Math.abs(sum / n))
  }
  const rms = Math.sqrt(pow / (n * ch.length))
  const loud = measureLoudness(ch, fs)
  const tp = truePeak(ch)
  let widthPct = 0, correlation = 1, lowCorrelation = 1, lowSideDb = -Infinity
  if (ch.length === 2) {
    const [L, R] = ch
    const M = new Float32Array(n), S = new Float32Array(n)
    let mp = 0, sp = 0
    for (let i = 0; i < n; i++) {
      M[i] = (L[i] + R[i]) / 2; S[i] = (L[i] - R[i]) / 2
      mp += M[i] * M[i]; sp += S[i] * S[i]
    }
    widthPct = mp > 0 ? Math.sqrt(sp / mp) * 100 : 0
    correlation = corr(L, R)
    const lp = lowpass(fs, 100)
    const Ml = lr4(M, lp), Sl = lr4(S, lp)
    let ml = 0, sl = 0
    for (let i = 0; i < n; i++) { ml += Ml[i] * Ml[i]; sl += Sl[i] * Sl[i] }
    lowSideDb = ml > 0 ? 10 * Math.log10((sl + 1e-30) / ml) : -Infinity
    lowCorrelation = corr(lr4(L, lp), lr4(R, lp))
  }
  const rmsDb = db(rms), pDb = db(peak)
  return {
    durationSec: n / fs, sampleRate: fs, channels: ch.length,
    lufs: loud.integrated, lra: loud.lra, rmsDb, samplePeakDb: pDb, truePeakDb: db(tp),
    crestDb: pDb - rmsDb, plrDb: db(tp) - loud.integrated,
    widthPct, correlation, lowCorrelation, lowSideDb, dcOffset: dc, clipRuns, invalidSamples: invalid,
    silent: !(loud.integrated > -60), tonal: tonal(ch, fs),
  }
}
