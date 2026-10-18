/** Mastering chain orchestration: analysis → decisions → DSP → verification. */
import { analyze, tonal, type Metrics } from './analysis'
import { ENGINE, GENRES, type GenreId } from './config'
import { bassMono, dynamicEq, hardClip, harshnessSidechain, limit, removeDc, staticEq, type DynEqStats, type LimiterStats } from './dsp'
import { db, measureLoudness, truePeakEnvelope, undb } from './loudness'

export interface Decision { stage: string; applied: boolean; amount: string; reason: string }
export interface Check { label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

export interface MasterReport {
  genre: GenreId
  before: Metrics
  after: Metrics
  decisions: Decision[]
  checks: Check[]
  clipper: { reductionDb: number; densityPct: number }
  limiter: LimiterStats
  dynEq: DynEqStats | null
  targetLufs: number
  targetReached: boolean
  streamingReady: boolean
}

type Progress = (stage: string, pct: number) => void
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const f1 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1)

export function master(input: Float32Array[], fs: number, genre: GenreId, onProgress: Progress = () => {}): { out: Float32Array[]; report: MasterReport } {
  const g = GENRES[genre]
  const decisions: Decision[] = []
  onProgress('Analyzing original audio', 5)
  const before = analyze(input, fs)
  if (before.invalidSamples > before.durationSec * fs * 0.01) throw new Error('The file contains corrupted (NaN/infinite) samples and cannot be processed safely.')
  if (before.silent) throw new Error('The file is silent or nearly silent (below −60 LUFS). Please check the upload.')
  if (before.durationSec < 1) throw new Error('The audio is shorter than one second.')

  const ch = input.map((c) => Float32Array.from(c))
  const stereo = ch.length === 2

  // DC offset
  if (before.dcOffset > 0.001) {
    removeDc(ch)
    decisions.push({ stage: 'DC offset', applied: true, amount: `${(before.dcOffset * 100).toFixed(2)}% removed`, reason: 'Measurable DC offset detected.' })
  }

  // Stage 2 — adaptive static EQ
  onProgress('Adaptive EQ', 22)
  const t = before.tonal
  const airDeficit = g.airRefDb - t.air
  let airDb = clamp(g.airShelfDb + 0.5 * airDeficit, 0, g.airShelfMaxDb)
  if (t.air >= g.airRefDb + 1) airDb = 0
  if (t.harsh > ENGINE.dynEq.thresholdDb + 2) airDb = Math.min(airDb, g.airShelfDb * 0.5)
  if (fs <= 24000) airDb = 0
  decisions.push({
    stage: 'High shelf >10 kHz', applied: airDb > 0.05, amount: airDb > 0.05 ? `${f1(airDb)} dB` : 'bypassed',
    reason: airDb > 0.05 ? `Air band is ${Math.abs(t.air - g.airRefDb).toFixed(1)} dB ${t.air < g.airRefDb ? 'below' : 'near'} the ${g.label} reference.` : 'Track already has enough high-frequency energy.',
  })
  const bassExcess = t.bass - g.bassRefDb
  let kickDb = clamp(g.kickBoostDb - 0.5 * bassExcess, 0, g.kickBoostMaxDb)
  let kickReason = `Low end sits ${Math.abs(bassExcess).toFixed(1)} dB ${bassExcess < 0 ? 'below' : 'around'} reference; kick fundamental at ${t.kickHz.toFixed(0)} Hz.`
  if (bassExcess > 1) { kickDb = 0; kickReason = 'Track already has sufficient bass.' }
  if (t.lowMid > ENGINE.mudGuardDb) { kickDb = 0; kickReason = 'Low-mids are dense — boosting would add mud.' }
  decisions.push({ stage: `Kick boost @ ${t.kickHz.toFixed(0)} Hz`, applied: kickDb > 0.05, amount: kickDb > 0.05 ? `${f1(kickDb)} dB` : 'bypassed', reason: kickReason })
  staticEq(ch, fs, airDb, t.kickHz, kickDb)

  // Stage 3 — adaptive dynamic EQ
  onProgress('Dynamic EQ (5–8 kHz)', 34)
  const sc = harshnessSidechain(ch, fs)
  const sorted = Float32Array.from(sc.filter((v) => v > -50)).sort()
  const pct = (p: number) => (sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : -60)
  const threshold = Math.max(ENGINE.dynEq.thresholdDb, pct(0.5) + ENGINE.dynEq.relativeAllowanceDb)
  let dyn: DynEqStats | null = null
  if (pct(0.98) > threshold) {
    dyn = dynamicEq(ch, fs, sc, threshold, g.dynEqMaxCutDb)
    decisions.push({ stage: 'Dynamic EQ 5–8 kHz', applied: dyn.maxCutDb > 0.1, amount: `up to −${dyn.maxCutDb.toFixed(1)} dB (active ${dyn.activePct.toFixed(0)}%)`, reason: 'Harsh/sibilant peaks exceeded the threshold; reduced only while present.' })
  } else {
    decisions.push({ stage: 'Dynamic EQ 5–8 kHz', applied: false, amount: 'bypassed', reason: 'No excessive harshness or sibilance detected.' })
  }

  // Stage 4 — bass mono
  onProgress('Low-end mono compatibility', 46)
  if (stereo && before.lowSideDb > ENGINE.mono.lowSideTriggerDb) {
    const want = ENGINE.mono.lowSideTriggerDb - 4
    const residual = clamp(undb(want - before.lowSideDb), ENGINE.mono.residualSide, 1)
    bassMono(ch, fs, g.monoCrossoverHz, residual)
    decisions.push({ stage: `Bass mono <${g.monoCrossoverHz} Hz`, applied: true, amount: `side −${(-db(residual)).toFixed(1)} dB`, reason: `Low-frequency side energy was ${before.lowSideDb.toFixed(1)} dB vs mid.` })
  } else {
    decisions.push({ stage: `Bass mono <${g.monoCrossoverHz} Hz`, applied: false, amount: 'bypassed', reason: stereo ? 'Low end is already mono-compatible.' : 'Mono source.' })
  }

  // Stage 5 — clipper
  onProgress('Clipping', 58)
  const preLufs = measureLoudness(ch, fs).integrated
  let peak = 0
  for (const c of ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a }
  let rms = 0
  for (const c of ch) for (let i = 0; i < c.length; i++) rms += c[i] * c[i]
  const preCrest = db(peak) - 10 * Math.log10(rms / (ch.length * ch[0].length))
  const need = g.targetLufs - preLufs
  let clipDb = Math.min(g.clipMaxDb, Math.max(0, need) * ENGINE.clipper.share) * clamp((preCrest - 8) / 4, 0, 1)
  let clipped = ch, density = 0
  for (let attempt = 0; attempt < 4 && clipDb > 0.05; attempt++) {
    const trial = ch.map((c) => Float32Array.from(c))
    density = hardClip(trial, peak * undb(-clipDb))
    clipped = trial
    if (density <= ENGINE.clipper.maxClipDensity) break
    clipDb *= 0.5
  }
  if (clipDb <= 0.05) { clipped = ch; clipDb = 0; density = 0 }
  decisions.push({
    stage: 'Hard clipper', applied: clipDb > 0, amount: clipDb > 0 ? `−${clipDb.toFixed(1)} dB peaks (${(density * 100).toFixed(2)}% samples)` : 'bypassed',
    reason: clipDb > 0 ? 'Shaves transient peaks so the limiter works less.' : preCrest < 10 ? 'Transients are already dense; clipping would add distortion.' : 'Little gain needed.',
  })

  // Stage 6 — limiter with gain search
  onProgress('Limiting & loudness', 70)
  const ceilLin = undb(g.ceilingDbtp - ENGINE.limiter.marginDb)
  const det = new Float32Array(clipped[0].length)
  for (const c of clipped) truePeakEnvelope(c, det)
  let detMax = 0
  for (let i = 0; i < det.length; i++) if (det[i] > detMax) detMax = det[i]
  const clipLufs = measureLoudness(clipped, fs).integrated
  // adaptive release: dense material gets a longer release to avoid low-end distortion
  const releaseMs = ENGINE.limiter.releaseMs * clamp(1 + (10 - preCrest) * 0.1, 0.6, 1.4)
  let loDb = db(ceilLin / detMax), hiDb = Infinity
  let gDb = Math.max(loDb, g.targetLufs - clipLufs)
  let best: { out: Float32Array[]; stats: LimiterStats; lufs: number } | null = null
  for (let it = 0; it < ENGINE.limiter.iterations; it++) {
    const res = limit(clipped, fs, det, undb(gDb), ceilLin, releaseMs)
    const L = measureLoudness(res.out, fs).integrated
    let pk = 0, pw = 0
    for (const c of res.out) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; pw += c[i] * c[i] }
    const crest = db(pk) - 10 * Math.log10(pw / (res.out.length * res.out[0].length))
    const ok = res.stats.peakGrDb <= ENGINE.limiter.maxPeakGrDb && crest >= ENGINE.limiter.minCrestDb
    if (ok) {
      if (!best || Math.abs(L - g.targetLufs) < Math.abs(best.lufs - g.targetLufs)) best = { ...res, lufs: L }
      loDb = gDb
      if (Math.abs(L - g.targetLufs) < 0.1) break
      const next = gDb + (g.targetLufs - L) * 1.1
      gDb = next >= hiDb ? (gDb + hiDb) / 2 : next
    } else {
      hiDb = gDb
      gDb = (loDb + hiDb) / 2
    }
    onProgress('Limiting & loudness', 70 + it * 3)
  }
  if (!best) {
    const res = limit(clipped, fs, det, undb(loDb), ceilLin, releaseMs)
    best = { ...res, lufs: measureLoudness(res.out, fs).integrated }
  }
  const out = best.out
  // gain modulation can introduce a tiny DC component; remove it before the final measurement
  removeDc(out)
  decisions.push({ stage: 'True-peak limiter', applied: true, amount: `peak GR ${best.stats.peakGrDb.toFixed(1)} dB, release ${releaseMs.toFixed(0)} ms`, reason: `Gain raised toward ${g.targetLufs} LUFS-I at a ${g.ceilingDbtp} dBTP ceiling.` })

  // Stage 7 — verification of the rendered result
  onProgress('Verifying master', 88)
  let after = analyze(out, fs)
  if (after.truePeakDb > g.ceilingDbtp) {
    const trim = undb(g.ceilingDbtp - after.truePeakDb - 0.05)
    for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= trim
    after = analyze(out, fs)
  }
  const checks: Check[] = []
  const targetReached = Math.abs(after.lufs - g.targetLufs) <= ENGINE.verify.lufsToleranceDb
  checks.push({ label: 'True peak ≤ ' + g.ceilingDbtp + ' dBTP', status: after.truePeakDb <= g.ceilingDbtp + 0.01 ? 'pass' : 'fail', detail: `${after.truePeakDb.toFixed(2)} dBTP` })
  checks.push({ label: 'No digital clipping', status: after.clipRuns === 0 ? 'pass' : 'fail', detail: `${after.clipRuns} clip events` })
  checks.push({
    label: `Loudness target ${g.targetLufs} LUFS-I`, status: targetReached ? 'pass' : 'warn',
    detail: targetReached ? `${after.lufs.toFixed(1)} LUFS-I` : `${after.lufs.toFixed(1)} LUFS-I — held back to protect audio quality`,
  })
  const [cLo, cHi] = g.crestRefDb
  checks.push({ label: `Crest factor (ref ${cLo}–${cHi} dB)`, status: after.crestDb >= cLo - 1.5 ? 'pass' : 'warn', detail: `${after.crestDb.toFixed(1)} dB` })
  if (stereo) {
    checks.push({ label: 'Bass mono-compatible', status: after.lowSideDb <= ENGINE.verify.lowSideMaxDb || after.lowSideDb <= before.lowSideDb ? 'pass' : 'warn', detail: `low side ${after.lowSideDb.toFixed(1)} dB, low corr ${after.lowCorrelation.toFixed(2)}` })
    const monoApplied = decisions.some((d) => d.stage.startsWith('Bass mono') && d.applied)
    const dw = Math.abs(after.widthPct - before.widthPct)
    const keep = dw <= Math.max(3, before.widthPct * 0.12)
    checks.push({
      label: 'Stereo image preserved', status: keep || monoApplied ? 'pass' : 'warn',
      detail: `width ${before.widthPct.toFixed(0)}% → ${after.widthPct.toFixed(0)}%${!keep && monoApplied ? ' (low-end side narrowed by design)' : ''}`,
    })
  }
  const distortion = density > ENGINE.clipper.maxClipDensity || best.stats.meanGrDb > 3
  checks.push({ label: 'No excessive distortion', status: distortion ? 'warn' : 'pass', detail: `clip ${(density * 100).toFixed(2)}% · avg limiting ${best.stats.meanGrDb.toFixed(1)} dB` })
  // tonal drift beyond intended EQ (proxy for audible degradation)
  const ta = tonal(out, fs)
  const drift = Math.max(Math.abs(ta.lowMid - t.lowMid), Math.abs(ta.harsh - t.harsh) - (dyn ? g.dynEqMaxCutDb : 0), Math.abs(ta.air - t.air) - airDb)
  checks.push({ label: 'Tonal balance intact', status: drift < 2.5 ? 'pass' : 'warn', detail: `max unintended shift ${Math.max(0, drift).toFixed(1)} dB` })
  const valid = after.invalidSamples === 0 && !after.silent
  checks.push({ label: 'Output integrity', status: valid ? 'pass' : 'fail', detail: valid ? 'No NaN/Inf, no silence' : 'Corrupted output' })
  onProgress('Verifying master', 95)
  const streamingReady = !checks.some((c) => c.status === 'fail')
  return {
    out,
    report: { genre, before, after, decisions, checks, clipper: { reductionDb: clipDb, densityPct: density * 100 }, limiter: best.stats, dynEq: dyn, targetLufs: g.targetLufs, targetReached, streamingReady },
  }
}
