/** Stages 2–6: processing blocks. Operate on Float32Array channels in place unless noted. */
import { bandpass, highpass, highShelf, lowpass, lr4, peaking, process } from './biquad'
import { ENGINE } from './config'
import { undb } from './loudness'

export function removeDc(ch: Float32Array[]) {
  for (const c of ch) {
    let s = 0
    for (let i = 0; i < c.length; i++) s += c[i]
    const m = s / c.length
    for (let i = 0; i < c.length; i++) c[i] -= m
  }
}

export function staticEq(ch: Float32Array[], fs: number, airDb: number, kickHz: number, kickDb: number) {
  for (const c of ch) {
    if (airDb > 0.05 && fs > 24000) process(c, highShelf(fs, ENGINE.airShelfHz, airDb, ENGINE.airShelfQ))
    if (kickDb > 0.05) process(c, peaking(fs, kickHz, kickDb, ENGINE.kickQ))
  }
}

/** Block-wise ratio (dB) of the 5–8 kHz band vs the 1–4 kHz reference band, on the mid signal. */
export function harshnessSidechain(ch: Float32Array[], fs: number): Float32Array {
  const n = ch[0].length
  const m = new Float32Array(n)
  for (const c of ch) for (let i = 0; i < n; i++) m[i] += c[i] / ch.length
  const cfg = ENGINE.dynEq
  const band = process(m, bandpass(fs, cfg.centerHz, cfg.q), new Float32Array(n))
  const ref = process(m, bandpass(fs, Math.sqrt(cfg.refLowHz * cfg.refHighHz), 0.7), new Float32Array(n))
  const blk = Math.max(16, Math.round((fs * cfg.blockMs) / 1000))
  const blocks = Math.floor(n / blk)
  const r = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let bp = 0, rp = 0
    for (let i = b * blk; i < (b + 1) * blk; i++) { bp += band[i] * band[i]; rp += ref[i] * ref[i] }
    r[b] = rp > 1e-12 ? 10 * Math.log10((bp + 1e-20) / rp) : -60
  }
  return r
}

export interface DynEqStats { maxCutDb: number; meanCutDb: number; activePct: number }

/** Dynamic band reduction: y = x + (g − 1)·BP(x), g driven by the harshness sidechain. */
export function dynamicEq(ch: Float32Array[], fs: number, sc: Float32Array, thresholdDb: number, maxCut: number): DynEqStats {
  const cfg = ENGINE.dynEq
  const n = ch[0].length
  const blk = Math.max(16, Math.round((fs * cfg.blockMs) / 1000))
  const att = Math.exp(-1 / ((fs * cfg.attackMs) / 1000)), rel = Math.exp(-1 / ((fs * cfg.releaseMs) / 1000))
  const gain = new Float32Array(n)
  let env = 0, maxC = 0, sumC = 0, active = 0
  for (let i = 0; i < n; i++) {
    const b = Math.min(sc.length - 1, Math.floor(i / blk))
    const target = Math.min(maxCut, Math.max(0, (sc[b] - thresholdDb) * cfg.ratio))
    env = target > env ? att * env + (1 - att) * target : rel * env + (1 - rel) * target
    gain[i] = undb(-env) - 1
    if (env > maxC) maxC = env
    sumC += env
    if (env > 0.1) active++
  }
  const c = bandpass(fs, cfg.centerHz, cfg.q)
  for (const x of ch) {
    const bp = process(x, c, new Float32Array(n))
    for (let i = 0; i < n; i++) x[i] += gain[i] * bp[i]
  }
  return { maxCutDb: maxC, meanCutDb: sumC / n, activePct: (active / n) * 100 }
}

/**
 * Low-frequency mono-isation in M/S. M and S both pass through the same LR4
 * split (an all-pass when summed), so inter-channel phase is preserved; only
 * side content below the crossover is attenuated.
 */
export function bassMono(ch: Float32Array[], fs: number, fc: number, residual: number) {
  const [L, R] = ch
  const n = L.length
  const M = new Float32Array(n), S = new Float32Array(n)
  for (let i = 0; i < n; i++) { M[i] = (L[i] + R[i]) / 2; S[i] = (L[i] - R[i]) / 2 }
  const lp = lowpass(fs, fc), hp = highpass(fs, fc)
  const Ml = lr4(M, lp), Mh = lr4(M, hp), Sl = lr4(S, lp), Sh = lr4(S, hp)
  for (let i = 0; i < n; i++) {
    const m = Ml[i] + Mh[i], s = Sh[i] + residual * Sl[i]
    L[i] = m + s; R[i] = m - s
  }
}

/** Hard, instantaneous clipper (KClip-style hard mode). Returns the fraction of samples clipped. */
export function hardClip(ch: Float32Array[], threshold: number): number {
  let clipped = 0, total = 0
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) {
      const v = c[i]
      if (v > threshold) { c[i] = threshold; clipped++ } else if (v < -threshold) { c[i] = -threshold; clipped++ }
    }
    total += c.length
  }
  return clipped / total
}

export interface LimiterStats { peakGrDb: number; meanGrDb: number; activePct: number }

/**
 * Look-ahead true-peak brickwall limiter. `detector` is the stereo-linked,
 * 4x-oversampled peak envelope of the un-gained input, so the gain search is cheap.
 */
export function limit(
  ch: Float32Array[], fs: number, detector: Float32Array, inGain: number, ceiling: number, releaseMs: number,
): { out: Float32Array[]; stats: LimiterStats } {
  const n = detector.length
  const L = Math.max(1, Math.round((fs * ENGINE.limiter.lookaheadMs) / 1000))
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) { const d = detector[i] * inGain; r[i] = d > ceiling ? ceiling / d : 1 }
  // running minimum over the future window [i, i+L] (monotonic deque)
  const h = new Float32Array(n)
  const dq = new Int32Array(n)
  let head = 0, tail = 0
  for (let j = n - 1; j >= 0; j--) {
    while (tail > head && r[dq[tail - 1]] >= r[j]) tail--
    dq[tail++] = j
    while (dq[head] > j + L) head++
    h[j] = r[dq[head]]
  }
  // instant attack on the held signal, exponential release
  const relC = Math.exp(-1 / ((fs * releaseMs) / 1000))
  const e = new Float32Array(n)
  let env = 1
  for (let i = 0; i < n; i++) {
    env = h[i] < env ? h[i] : h[i] + (env - h[i]) * relC
    e[i] = env
  }
  // boxcar over [i−L, i] spreads the attack smoothly across the look-ahead time
  const g = new Float32Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += e[i]
    if (i > L) acc -= e[i - L - 1]
    g[i] = i >= L ? acc / (L + 1) : Math.min(acc / (i + 1), e[i])
  }
  let minG = 1, sumGr = 0, active = 0
  for (let i = 0; i < n; i++) {
    if (g[i] < minG) minG = g[i]
    const gr = -20 * Math.log10(g[i])
    sumGr += gr
    if (gr > 0.1) active++
  }
  const out = ch.map((c) => {
    const o = new Float32Array(n)
    for (let i = 0; i < n; i++) o[i] = c[i] * inGain * g[i]
    return o
  })
  return { out, stats: { peakGrDb: -20 * Math.log10(minG), meanGrDb: sumGr / n, activePct: (active / n) * 100 } }
}
