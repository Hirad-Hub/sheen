import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteMasteringDraft, getMasteringDraft } from '../manualMastering/drafts'
import { sendEmailOtp, verifyEmailOtp, type VerifiedEmailSession } from '../manualMastering/auth'
import { guessCurrencyFromBrowser, lookupCurrency, type PaymentCurrency } from '../manualMastering/location'
import { submitMasteringRequest } from '../manualMastering/submit'
import { validateFile } from '../audio/client'

const price = (currency: PaymentCurrency, amount: number) => new Intl.NumberFormat(currency === 'EUR' ? 'en-IE' : 'en-US', { style: 'currency', currency }).format(amount)

export default function ManualMasteringPage() {
  const draftId = new URLSearchParams(window.location.search).get('draft')
  const [file, setFile] = useState<File | null>(null)
  const [email, setEmail] = useState('')
  const [currency, setCurrency] = useState<PaymentCurrency>(guessCurrencyFromBrowser)
  const [step, setStep] = useState<'offer' | 'request' | 'verify' | 'success'>('offer')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifiedSession, setVerifiedSession] = useState<VerifiedEmailSession | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const audioUrl = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const paypalUrl = currency === 'EUR' ? 'https://paypal.me/HiradG/14.99EUR' : 'https://paypal.me/HiradG/14.99USD'

  useEffect(() => {
    if (!draftId) return
    void getMasteringDraft(draftId).then((loaded) => {
      setFile(loaded?.file ?? null)
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load your audio file.'))
  }, [draftId])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    void lookupCurrency(controller.signal).then(setCurrency).catch(() => {}).finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [])

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = window.setTimeout(() => setResendCountdown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCountdown])

  const selectFile = (candidate?: File) => {
    if (!candidate) return
    const validationError = validateFile(candidate)
    if (validationError) { setError(validationError); return }
    setFile(candidate); setError(null)
  }

  const beginEmailVerification = async () => {
    if (!file) { setError('Please add your song first.'); return }
    if (!emailValid) { setError('Enter a valid email address so we can send your finished master.'); return }
    setSubmitting(true); setError(null)
    try {
      await sendEmailOtp(email)
      setVerificationCode('')
      setVerifiedSession(null)
      setResendCountdown(60)
      setStep('verify')
    } catch (e) { setError(e instanceof Error ? e.message : 'We could not send your verification code. Please try again.') }
    finally { setSubmitting(false) }
  }

  const resendEmailCode = async () => {
    setResending(true); setError(null)
    try {
      await sendEmailOtp(email)
      setResendCountdown(60)
    } catch (e) { setError(e instanceof Error ? e.message : 'We could not resend your verification code. Please try again.') }
    finally { setResending(false) }
  }

  const verifyAndSubmit = async () => {
    if (!file) { setError('Please add your song first.'); return }
    setSubmitting(true); setError(null)
    try {
      const session = verifiedSession ?? await verifyEmailOtp(email, verificationCode)
      setVerifiedSession(session)
      await submitMasteringRequest(file, email, session, setUploadProgress)
      if (draftId) await deleteMasteringDraft(draftId).catch(() => {})
      setStep('success')
    } catch (e) { setError(e instanceof Error ? e.message : 'We could not verify your email or submit your request. Please try again.') }
    finally { setSubmitting(false) }
  }

  return <div className="min-h-screen bg-ink text-white">
    <header className="mx-auto flex max-w-6xl items-center px-6 py-6"><a href="/" className="flex items-center gap-2.5"><span className="flex h-6 items-end gap-[3px]">{[10, 18, 24, 14, 20].map((h, i) => <span key={i} className="w-[3px] rounded-full bg-glow" style={{ height: h }} />)}</span><span className="text-[19px] font-semibold tracking-tight">Sheen</span></a><span className="ml-auto text-[13px] text-mute">Human mastering</span></header>
    <main className="mx-auto max-w-6xl px-6 pb-16">
      {step === 'offer' && <>
        <section className="grid items-center gap-8 pt-6 md:grid-cols-[1.1fr_.9fr] md:gap-12 md:pt-12">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[.16em] text-glow-soft">A human touch for your song</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Take your master one step further.</h1>
            <p className="mt-4 max-w-xl text-[17px] leading-7 text-mute">A professional mastering engineer will carefully refine your track and send the finished version to your email within a few hours.</p>
            <ul className="mt-6 space-y-3 text-[15px]">
              {['Hands-on mastering by an experienced engineer', 'A polished finish tailored to your song', 'Pay only after you receive your mastered song'].map((item) => <li key={item} className="flex items-start gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-good/15 text-[13px] text-good">✓</span><span>{item}</span></li>)}
            </ul>
            <div className="mt-7 flex flex-wrap items-baseline gap-3"><span className="text-[17px] text-mute line-through decoration-white/50">{price(currency, 49)}</span><span className="text-4xl font-semibold tracking-tight text-glow">{price(currency, 14.99)}</span><span className="text-[13px] text-mute">per song · paid after delivery</span></div>
            <button onClick={() => setStep('request')} className="mt-6 rounded-full bg-glow px-8 py-4 text-[16px] font-medium text-white transition hover:bg-[#e65f0c]">Start my order</button>
            <p className="mt-3 text-[13px] text-mute">No payment now. We’ll email you when your master is ready.</p>
          </div>
          <figure className="relative min-h-[310px] overflow-hidden rounded-[28px] border border-line bg-panel sm:min-h-[390px]">
            <img src="/mastering-engineer.jpeg" alt="Mastering engineer in a recording studio" className="absolute inset-0 size-full object-cover object-[center_38%]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-transparent" />
            <figcaption className="absolute inset-x-0 bottom-0 p-6 text-[15px] font-medium text-white sm:p-7">Your song, refined by an experienced mastering engineer</figcaption>
          </figure>
        </section>

        <section className="mt-16 border-t border-line pt-10">
          <div className="text-center"><h2 className="text-[25px] font-semibold">Customer stories</h2><p className="mt-2 text-[15px] text-mute">Real customer quotes and before-and-after clips will go here.</p></div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((number) => <article key={number} className="rounded-2xl border border-dashed border-line bg-panel/40 p-4"><div className="text-[13px] font-medium text-mute">Review {number} · placeholder</div><div className="mt-3 text-[13px] text-mute">[Customer name] · [5-star rating]</div><p className="mt-2 text-[13px] leading-5 text-mute">[Add an authentic customer comment here.]</p><div className="mt-4 space-y-2"><div className="rounded-lg bg-black/20 px-3 py-2 text-[12px] text-mute">Before audio placeholder</div><div className="rounded-lg bg-black/20 px-3 py-2 text-[12px] text-mute">After audio placeholder</div></div></article>)}</div>
        </section>
      </>}

      {step === 'request' && <section className="mx-auto max-w-2xl pt-8 sm:pt-14">
        <button onClick={() => setStep('offer')} className="text-[14px] text-mute hover:text-white">← Back to details</button>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Your song and delivery email</h1>
        <p className="mt-2 text-[15px] text-mute">Check the track, replace it if needed, then tell us where to send your finished master.</p>
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5">
          {file ? <><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-glow">♫</span><div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{file.name}</div><div className="text-[13px] text-mute">{(file.size / 1024 / 1024).toFixed(1)} MB</div></div><button onClick={() => input.current?.click()} className="rounded-full border border-line px-4 py-2 text-[13px] hover:border-white/25">Replace</button></div>{audioUrl && <audio className="mt-4 w-full" controls src={audioUrl} />}</> : <button onClick={() => input.current?.click()} className="w-full rounded-xl border border-dashed border-line p-8 text-[15px] text-mute hover:border-white/25">Choose a WAV or MP3 to master</button>}
          <input ref={input} hidden type="file" accept=".wav,.wave,.mp3,audio/wav,audio/mpeg" onChange={(e) => { selectFile(e.target.files?.[0]); e.currentTarget.value = '' }} />
        </div>
        <label className="mt-6 block text-[13px] text-mute" htmlFor="request-email">Email for delivery</label>
        <input id="request-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="you@example.com" className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3.5 text-[15px] outline-none focus:border-glow/70" />
        {error && <p role="alert" className="mt-3 rounded-xl border border-bad/20 bg-bad/10 px-4 py-3 text-[13px] text-bad">{error}</p>}
        {submitting && <div className="mt-5"><div className="flex justify-between text-[13px] text-mute"><span>Uploading your audio securely</span><span>{uploadProgress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-glow transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
        <button disabled={submitting} onClick={() => void beginEmailVerification()} className="mt-6 w-full rounded-full bg-glow px-6 py-4 text-[16px] font-medium text-white transition hover:bg-[#e65f0c] disabled:cursor-wait disabled:opacity-60">{submitting ? 'Sending your code…' : 'Continue with email verification'}</button>
        <p className="mt-3 text-center text-[13px] text-mute">We’ll send a one-time code to confirm your email. No payment is needed now.</p>
      </section>}

      {step === 'verify' && <section className="mx-auto max-w-xl pt-8 sm:pt-14">
        <button onClick={() => { setStep('request'); setVerifiedSession(null); setVerificationCode(''); setError(null) }} className="text-[14px] text-mute hover:text-white">← Change email or song</button>
        <div className="mt-6 rounded-2xl border border-line bg-panel p-6 sm:p-8">
          <div className="grid size-12 place-items-center rounded-full bg-glow/10 text-glow"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-[15px] leading-6 text-mute">We sent a one-time verification code to <span className="text-white">{email}</span>. Enter it below to securely submit your song.</p>
          {file && <div className="mt-5 truncate rounded-xl border border-line bg-black/15 px-4 py-3 text-[14px] text-mute">Song: <span className="text-white">{file.name}</span></div>}
          {verifiedSession ? <div className="mt-5 rounded-xl border border-good/20 bg-good/10 px-4 py-3 text-[14px] text-good">Email verified. Your request is being securely uploaded.</div> : <>
            <label className="mt-6 block text-[13px] text-mute" htmlFor="verification-code">Verification code</label>
            <input id="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={verificationCode} onChange={(e) => { setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 8)); setError(null) }} placeholder="Enter the code from your email" className="mt-2 w-full rounded-xl border border-line bg-black/20 px-4 py-4 text-center text-[22px] tracking-[.3em] outline-none placeholder:text-[14px] placeholder:tracking-normal focus:border-glow/70" />
          </>}
          {error && <p role="alert" className="mt-4 rounded-xl border border-bad/20 bg-bad/10 px-4 py-3 text-[13px] text-bad">{error}</p>}
          {submitting && verifiedSession && <div className="mt-5"><div className="flex justify-between text-[13px] text-mute"><span>{uploadProgress < 100 ? 'Uploading your audio securely' : 'Saving your request'}</span><span>{uploadProgress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-glow transition-[width]" style={{ width: `${uploadProgress}%` }} /></div></div>}
          <button disabled={submitting || (!verifiedSession && verificationCode.length < 6)} onClick={() => void verifyAndSubmit()} className="mt-6 w-full rounded-full bg-glow px-6 py-4 text-[16px] font-medium text-white transition hover:bg-[#e65f0c] disabled:cursor-wait disabled:opacity-60">{submitting ? (verifiedSession ? (uploadProgress < 100 ? 'Uploading your song…' : 'Saving your request…') : 'Verifying your email…') : (verifiedSession ? 'Retry secure upload' : 'Verify email and submit request')}</button>
          {!verifiedSession && <div className="mt-4 text-center text-[13px] text-mute">{resendCountdown > 0 ? <>You can request another code in {resendCountdown}s.</> : <>Didn’t get the email? <button disabled={resending} onClick={() => void resendEmailCode()} className="font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">{resending ? 'Sending…' : 'Resend code'}</button></>}</div>}
          <p className="mt-4 text-center text-[12px] leading-5 text-mute">Check your spam folder if it doesn’t arrive. The code is only used to verify your email address.</p>
        </div>
      </section>}

      {step === 'success' && <section className="mx-auto max-w-xl pt-16 text-center sm:pt-24"><div className="mx-auto grid size-16 place-items-center rounded-full border border-good/30 bg-good/10 text-2xl text-good">✓</div><h1 className="mt-6 text-3xl font-semibold">Your request is in.</h1><p className="mt-3 text-[16px] leading-7 text-mute">We’ve received your song request. An experienced mastering engineer will finish your master as soon as possible and email it to <span className="text-white">{email}</span>.</p><div className="mt-7 rounded-2xl border border-line bg-panel p-6"><p className="text-[15px] leading-6 text-white">If you’d like, you can pay now through PayPal.</p><a href={paypalUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full justify-center rounded-full bg-glow px-6 py-4 text-[16px] font-medium text-white transition hover:bg-[#e65f0c]">Pay {price(currency, 14.99)} now with PayPal</a><p className="mt-4 text-[14px] leading-6 text-mute">No pressure if you’d rather wait. That’s completely fine—you can pay after you receive your mastered song by email.</p></div><a href="/" className="mt-7 inline-flex rounded-full border border-line px-6 py-3 text-[15px] hover:border-white/25">Back to Sheen</a></section>}
    </main>
  </div>
}
