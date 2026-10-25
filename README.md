# Sheen — mastering for Suno & AI-generated songs

Upload WAV/MP3 → pick a genre → real analysis + DSP → A/B listen with waveforms → download.
Single tracks are free. Batches (2+ tracks) download as one ZIP behind a €1.99/track Stripe checkout.

## Run

```bash
pnpm install
pnpm dev            # development
pnpm build          # production build → dist/ (static; deploy to any static host)
pnpm test:engine    # DSP test suite: 5 genres × 7 problem tracks + WAV round trip + all MP3 bitrates
node tests/e2e.mjs a.wav b.mp3   # headless-browser end-to-end run against the dev server (needs Chromium)
```

## Architecture

All DSP runs in a Web Worker in the browser, on the real audio samples. Nothing is simulated, and audio never leaves the user's machine.

| Module | Responsibility |
|---|---|
| `src/audio/config.ts` | **Genre profiles and every engine parameter.** Recalibrate here. |
| `src/audio/loudness.ts` | ITU-R BS.1770-4: K-weighting, gated LUFS-I, LRA, 4× oversampled true peak |
| `src/audio/analysis.ts` | Stage 1/7 metrics: RMS, crest, PLR, spectrum/tonal balance, kick fundamental, width, correlation, LF side energy, DC, clip runs, NaN/Inf, silence |
| `src/audio/dsp.ts` | EQ, dynamic EQ, LR4 bass mono, hard clipper, look-ahead true-peak limiter |
| `src/audio/master.ts` | Chain orchestration, adaptive decisions, quality guards, final verification |
| `src/audio/wav.ts`, `mp3.ts` | WAV decode/encode (16/24/32f, sample rate kept), LAME MP3 encode |
| `src/audio/worker.ts`, `client.ts` | Worker protocol; MP3 decoding plus **decode-and-re-measure of the encoded MP3** |
| `src/audio/exportZip.ts` | ZIP export (stored, NFC-normalised, Windows-safe names) |
| `src/payments/checkout.ts` | Stripe integration point |

## Chain

1. **Analyze**: all the measurements above.
2. **Adaptive EQ**: a >10 kHz shelf sized by the air-band deficit against the genre reference (bypassed if the track is already bright or harsh). A kick-fundamental bell (40–100 Hz peak detection), bypassed if the bass is already sufficient or the low-mids are dense (mud guard).
3. **Dynamic EQ, 5–8 kHz**: a sidechain compares band energy with the 1–4 kHz band in 5 ms blocks. It cuts only above max(absolute threshold, track median + 3 dB), up to the genre maximum.
4. **Bass mono**: applied only if side energy below 100 Hz is above −14 dB relative to mid. M and S both pass the same LR4 split, so phase is preserved, and only the low side is attenuated.
5. **Clipper**: hard clip, at most 2 dB of peak reduction. It is scaled down on dense material and backed off if clip density goes above 2 %.
6. **Limiter**: 1 ms look-ahead, true-peak detection, 600 ms release (adaptive 360–840 ms by crest factor), −1 dBTP ceiling. An iterative gain search toward the genre LUFS target stops at the quality guards (peak GR ≤ 6 dB, crest ≥ 7 dB), so it reports the actual result instead of forcing the number.
7. **Verify** the rendered result: TP, clipping, LUFS, crest, low-end mono, stereo preservation, distortion proxies, tonal drift, NaN/silence. The MP3 is then decoded and measured again. If it overs, it is re-encoded from the master with a trim.

## Notes and limitations

- **Limiter "attack 5.5 s"**: treated as 5.5 ms (`ENGINE.limiter.attackMs`). With a 1 ms look-ahead brickwall, the effective attack is the look-ahead, which is how Pro-L 2 behaves too. The value is kept in config for calibration.
- KClip/Pro-L 2 are behavioural references, not clones. The clipper runs at the native sample rate; the limiter's true-peak detector catches the resulting inter-sample peaks.
- The BS.1770 implementation follows the spec, using the libebur128 coefficient derivation. Validate against a reference meter during calibration.
- Very loud targets (−8 LUFS) are often not reachable cleanly on dynamic material. The UI then says so honestly.
- WAV sources above 48 kHz are resampled for the MP3 only. The WAV keeps the source rate and bit depth (16-bit gets TPDF dither).
- Browser memory limits very large batches (each track is held as a WAV blob). Processing is sequential, one track at a time.

## Stripe

1. Deploy `server/stripe-checkout.example.ts` (or an equivalent serverless function) with `STRIPE_SECRET_KEY`.
2. Set `VITE_STRIPE_CHECKOUT_ENDPOINT` and `VITE_STRIPE_STATUS_ENDPOINT`, then rebuild.
Until then the checkout modal reports that payments are not connected. In `pnpm dev` only, it also offers a test unlock.

### Manual mastering

The result page opens a separate human-mastering offer page in a new tab. It displays the discounted 14.99 local-currency offer, lets the customer review or replace their audio, and submits the file and email to a private Supabase bucket/table. Europe is detected by IP continent and shown EUR; other regions are shown USD, with a browser locale/time-zone fallback.

To enable request submission, run `supabase/manual-mastering-setup.sql` in the Supabase SQL Editor, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the frontend environment and rebuild. In Supabase Auth, enable email sign-in/confirmations and configure the Magic Link email template to include `{{ .Token }}` (not only `{{ .ConfirmationURL }}`) so customers receive a one-time code. The request form verifies that code before uploading audio and submitting the order. The SQL grants verified users insert-only access to their own request and audio in the private `mastering-uploads` bucket; it does not grant read/list access to customer requests or audio. The file is uploaded directly to private Supabase Storage and then its email/path is recorded in `manual_mastering_requests`. Do not add a secret/service-role key to frontend environment variables.

The supplied engineer portrait is shown on the offer page. Four review/audio cards remain clearly marked placeholders until authentic testimonials and audio samples are added. After the verified request is received, customers can optionally pay the current 14.99 local-currency price through PayPal or wait to pay after delivery. The form does not automate the later engineer delivery or collect the post-delivery payment.

### Shareable results

Run `supabase/shared-results-setup.sql` in the configured Supabase project. On a completed single-track result, **Share results** uploads the original plus mastered MP3 to the public `share-results` bucket and creates a unique filename-based result page. Shared pages use `?share=<short-name>` and have no built-in expiry or deletion. Set `VITE_SHARE_BASE_URL` to the deployed canonical site URL if the app is served from different domains; without it, the share link uses the current site origin. A localhost preview cannot produce links that other people can open.

Anyone with a link can listen to and download both files. Uploading uses the public Supabase key and an anonymous Storage insert policy limited to audio types and 50 MB per file. This is intentionally public for frictionless sharing, but it is not an abuse-proof upload service: anyone can attempt uploads to that bucket. Review Supabase usage, restrict public creation or add a CAPTCHA/server-side upload gate before promoting the feature broadly. The share files count against the same project storage and bandwidth quotas as other Supabase data.
