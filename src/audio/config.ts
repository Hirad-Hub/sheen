/**
 * Mastering configuration. All values are calibration points — adjust here
 * (no other code changes needed) to re-tune the engine.
 */
export type GenreId = 'pop' | 'rnb' | 'edm' | 'rock' | 'country'

export interface GenreProfile {
  id: GenreId
  label: string
  blurb: string
  airShelfDb: number // starting high-shelf boost above 10 kHz
  airShelfMaxDb: number
  dynEqMaxCutDb: number // max dynamic reduction 5–8 kHz (positive number)
  kickBoostDb: number
  kickBoostMaxDb: number
  monoCrossoverHz: number
  targetLufs: number
  crestRefDb: [number, number]
  clipMaxDb: number
  ceilingDbtp: number
  /** Tonal references (pink-normalised, relative to the 1–4 kHz band, dB). */
  airRefDb: number
  bassRefDb: number
}

export const GENRES: Record<GenreId, GenreProfile> = {
  pop: {
    id: 'pop', label: 'Pop', blurb: 'Balanced, polished, bright',
    airShelfDb: 1.5, airShelfMaxDb: 3, dynEqMaxCutDb: 1.5, kickBoostDb: 0.5, kickBoostMaxDb: 1,
    monoCrossoverHz: 100, targetLufs: -9, crestRefDb: [9, 10], clipMaxDb: 2, ceilingDbtp: -1,
    airRefDb: -9, bassRefDb: 5,
  },
  rnb: {
    id: 'rnb', label: 'R&B / Hip-Hop', blurb: 'Weighty lows, clear vocal',
    airShelfDb: 1, airShelfMaxDb: 3, dynEqMaxCutDb: 2, kickBoostDb: 1, kickBoostMaxDb: 1.5,
    monoCrossoverHz: 100, targetLufs: -8.5, crestRefDb: [9, 10], clipMaxDb: 2, ceilingDbtp: -1,
    airRefDb: -10, bassRefDb: 7,
  },
  edm: {
    id: 'edm', label: 'EDM & Dance', blurb: 'Pronounced lows & highs, loud',
    airShelfDb: 2, airShelfMaxDb: 4, dynEqMaxCutDb: 1.5, kickBoostDb: 1, kickBoostMaxDb: 2,
    monoCrossoverHz: 100, targetLufs: -8, crestRefDb: [9, 10], clipMaxDb: 2, ceilingDbtp: -1,
    airRefDb: -8, bassRefDb: 7,
  },
  rock: {
    id: 'rock', label: 'Rock', blurb: 'Punchy, controlled top end',
    airShelfDb: 0.5, airShelfMaxDb: 2, dynEqMaxCutDb: 2, kickBoostDb: 0.5, kickBoostMaxDb: 1,
    monoCrossoverHz: 100, targetLufs: -9, crestRefDb: [9, 10], clipMaxDb: 2, ceilingDbtp: -1,
    airRefDb: -10, bassRefDb: 4,
  },
  country: {
    id: 'country', label: 'Country', blurb: 'Natural, open, gentle',
    airShelfDb: 0.5, airShelfMaxDb: 2, dynEqMaxCutDb: 1.5, kickBoostDb: 0.5, kickBoostMaxDb: 1,
    monoCrossoverHz: 100, targetLufs: -10, crestRefDb: [9, 10], clipMaxDb: 2, ceilingDbtp: -1,
    airRefDb: -10, bassRefDb: 4,
  },
}

export const ENGINE = {
  airShelfHz: 10000,
  airShelfQ: 0.6,
  kickSearchHz: [40, 100] as [number, number],
  kickDefaultHz: 55,
  kickQ: 0.9,
  /** Low-mid (200–500 Hz) level vs 1–4 kHz above which the kick boost is withheld (mud guard). */
  mudGuardDb: 6,
  dynEq: {
    centerHz: 6300, q: 0.9, refLowHz: 1000, refHighHz: 4000,
    /** absolute harshness threshold: 5–8 kHz band power vs 1–4 kHz reference band (dB) */
    thresholdDb: -3,
    /** threshold also sits this far above the track's own median ratio */
    relativeAllowanceDb: 3,
    ratio: 0.5, blockMs: 5, attackMs: 5, releaseMs: 80,
  },
  mono: {
    /** side/mid energy ratio below the crossover above which correction is applied (dB) */
    lowSideTriggerDb: -14,
    /** minimum remaining fraction of side signal below the crossover */
    residualSide: 0.15,
  },
  clipper: {
    /** share of the needed gain the clipper may take before the limiter */
    share: 0.4,
    /** clip density above which clipping is backed off (fraction of samples) */
    maxClipDensity: 0.02,
  },
  limiter: {
    lookaheadMs: 1,
    /** Interpreted as 5.5 ms (see README). With 1 ms look-ahead the brickwall attack equals the look-ahead. */
    attackMs: 5.5,
    releaseMs: 600,
    /** internal margin below the ceiling to absorb inter-sample overs from gain modulation */
    marginDb: 0.15,
    /** quality guard: max peak gain reduction accepted */
    maxPeakGrDb: 6,
    /** quality guard: min crest factor (sample peak − RMS) accepted */
    minCrestDb: 7,
    iterations: 6,
  },
  verify: {
    lufsToleranceDb: 0.5,
    clipRunSamples: 3,
    lowSideMaxDb: -12,
  },
  /** WAV delivery: 'match' keeps source bit depth (16-bit gets TPDF dither), or force 24. */
  wavOutput: 'match' as 'match' | '24',
  maxFileBytes: 500 * 1024 * 1024,
  maxDurationSec: 20 * 60,
}

export const MP3_BITRATES = [320, 256, 192, 128] as const
export type Mp3Bitrate = (typeof MP3_BITRATES)[number]
