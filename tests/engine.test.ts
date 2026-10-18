/** End-to-end engine test on synthetic tracks: run with `pnpm test:engine`. */
import { master } from '../src/audio/master'
import { GENRES, MP3_BITRATES, type GenreId } from '../src/audio/config'
import { decodeWav, encodeWav } from '../src/audio/wav'
import { encodeMp3 } from '../src/audio/mp3'
import { measureLoudness } from '../src/audio/loudness'

const fs = 44100, dur = 20
type Opts = { hats?: number; harsh?: number; bass?: number; width?: number; lowSide?: number; gain?: number }
function synth(o: Opts): Float32Array[] {
  const n = fs * dur, L = new Float32Array(n), R = new Float32Array(n)
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  let hp = 0, hpPrev = 0, nL = 0, nR = 0
  for (let i = 0; i < n; i++) {
    const t = i / fs, beat = t % 0.5, bar = Math.floor(t / 2) % 4
    const kick = Math.sin(2 * Math.PI * (55 * beat + 60 * (1 - Math.exp(-beat * 30)) / 30)) * Math.exp(-beat * 8) * 0.6
    const root = [55, 49, 41.2, 46.25][bar]
    const bass = Math.sin(2 * Math.PI * root * t) * 0.25 * (o.bass ?? 1)
    const bassSide = Math.sin(2 * Math.PI * root * 1.01 * t) * 0.15 * (o.lowSide ?? 0)
    let pad = 0
    for (const m of [4, 5, 6]) pad += Math.sin(2 * Math.PI * root * m * t) * 0.05 + Math.sin(2 * Math.PI * root * m * 2.003 * t) * 0.03
    const voc = Math.sin(2 * Math.PI * 220 * t + 3 * Math.sin(2 * Math.PI * 5 * t)) * 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t))
    const w = rnd(); hp = 0.9 * (hp + w - hpPrev); hpPrev = w
    const hat = hp * Math.exp(-(t % 0.25) * 40) * 0.15 * (o.hats ?? 0.3)
    const sib = Math.sin(2 * Math.PI * 6500 * t) * rnd() * 0.25 * (o.harsh ?? 0) * ((t % 1) < 0.15 ? 1 : 0)
    nL = 0.98 * nL + rnd() * 0.02; nR = 0.98 * nR + rnd() * 0.02
    const wd = o.width ?? 0.3
    const mid = kick + bass + pad + voc + hat + sib
    L[i] = (mid + bassSide + wd * (pad * 0.5 + nL)) * (o.gain ?? 0.5)
    R[i] = (mid - bassSide + wd * (-pad * 0.5 + nR)) * (o.gain ?? 0.5)
  }
  return [L, R]
}

const cases: [string, Opts][] = [
  ['dull/typical AI', { hats: 0.1 }],
  ['already bright', { hats: 3 }],
  ['harsh', { harsh: 1.5 }],
  ['excessive bass', { bass: 3 }],
  ['wide w/ stereo bass', { width: 1.2, lowSide: 2 }],
  ['narrow / mono-ish', { width: 0 }],
  ['very quiet', { gain: 0.06 }],
]
let failures = 0
for (const genre of Object.keys(GENRES) as GenreId[]) {
  for (const [name, o] of cases) {
    const t0 = Date.now()
    const { out, report: r } = master(synth(o), fs, genre)
    const applied = r.decisions.filter((d) => d.applied).map((d) => d.stage.split(' ')[0] + (d.stage.includes('Kick') ? 'Kick' : '')).join(',')
    const fails = r.checks.filter((c) => c.status === 'fail')
    const warns = r.checks.filter((c) => c.status === 'warn').map((c) => c.label)
    failures += fails.length
    // WAV export round trip
    const back = decodeWav(encodeWav(out, fs, 24))
    const rt = measureLoudness(back.channels, fs).integrated
    if (Math.abs(rt - r.after.lufs) > 0.05) { failures++; console.log('  WAV round-trip mismatch') }
    console.log(`${genre.padEnd(7)} ${name.padEnd(20)} ${r.before.lufs.toFixed(1)}→${r.after.lufs.toFixed(1)} LUFS (tgt ${r.targetLufs}) TP ${r.after.truePeakDb.toFixed(2)} crest ${r.after.crestDb.toFixed(1)} lowSide ${r.before.lowSideDb.toFixed(0)}→${r.after.lowSideDb.toFixed(0)} [${applied}] ${warns.length ? 'WARN:' + warns.join('|') : ''} ${fails.map((f) => 'FAIL:' + f.label).join(' ')} ${Date.now() - t0}ms`)
  }
}
// MP3 encode at every bitrate
const { out } = master(synth({}), fs, 'pop')
for (const b of MP3_BITRATES) {
  const mp3 = encodeMp3(out, fs, b)
  const kbps = (mp3.length * 8) / dur / 1000
  const ok = mp3[0] === 0xff && Math.abs(kbps - b) < b * 0.1
  if (!ok) failures++
  console.log(`MP3 ${b} kbps → ${(mp3.length / 1024).toFixed(0)} KB, measured ${kbps.toFixed(0)} kbps ${ok ? 'OK' : 'FAIL'}`)
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
