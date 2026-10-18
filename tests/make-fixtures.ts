import { writeFileSync } from 'node:fs'
import { encodeWav } from '../src/audio/wav'
import { encodeMp3 } from '../src/audio/mp3'
const fs = 44100, n = fs * 12
const L = new Float32Array(n), R = new Float32Array(n)
let s = 1
const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
let lp = 0
for (let i = 0; i < n; i++) {
  const t = i / fs, beat = t % 0.5
  lp += 0.3 * (r() * 0.2 - lp)
  const k = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-beat * 8) * 0.3
  const v = Math.sin(2 * Math.PI * 330 * t) * 0.08
  L[i] = lp + k + v + r() * 0.01; R[i] = lp + k + v - r() * 0.01
}
writeFileSync('/tmp/fx.wav', new Uint8Array(encodeWav([L, R], fs, 24)))
writeFileSync('/tmp/fx.mp3', encodeMp3([L, R], fs, 192))
