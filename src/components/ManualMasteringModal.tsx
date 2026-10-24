import { useEffect, useState } from 'react'

type Props = { trackName: string; onClose: () => void }
type PaymentCurrency = 'EUR' | 'USD'
const PAYPAL_LINKS: Record<PaymentCurrency, string> = {
  EUR: 'https://paypal.me/HiradG/9.99EUR',
  USD: 'https://paypal.me/HiradG/9.99USD',
}
const EUROPE_TIMEZONES = ['Europe/']
const EUROPE_LOCALES = new Set(['AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA', 'AL', 'AD', 'BA', 'BY', 'XK'])

function guessCurrencyFromBrowser(): PaymentCurrency {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  const region = navigator.language.match(/-([A-Za-z]{2})(?:-|$)/)?.[1]?.toUpperCase()
  return EUROPE_TIMEZONES.some((prefix) => timezone.startsWith(prefix)) || (region ? EUROPE_LOCALES.has(region) : false) ? 'EUR' : 'USD'
}

export default function ManualMasteringModal({ trackName, onClose }: Props) {
  const [step, setStep] = useState<'details' | 'email'>('details')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [currency, setCurrency] = useState<PaymentCurrency>(guessCurrencyFromBrowser)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    fetch('https://ipapi.co/continent_code/', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error('Location lookup failed')))
      .then((continent) => setCurrency(continent.trim().toUpperCase() === 'EU' ? 'EUR' : 'USD'))
      .catch(() => { /* Keep the browser locale/time-zone estimate if IP lookup is unavailable. */ })
      .finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-mastering-title" className="my-auto w-full max-w-lg rounded-3xl border border-line bg-[#141416] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-glow/25 bg-glow/10 px-3 py-1 text-[13px] text-glow-soft">
              <span className="size-1.5 rounded-full bg-glow" /> Human mastering
            </div>
            <h2 id="manual-mastering-title" className="text-[25px] font-semibold tracking-tight">{step === 'details' ? 'A studio-quality finishing touch.' : 'Where should we send it?'}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-mute hover:text-white">×</button>
        </div>

        {step === 'details' ? <>
          <p className="mt-3 text-[15px] leading-6 text-mute">A professional mastering engineer will refine your track and email your upgraded, release-ready master within a few hours.</p>
          <ul className="mt-6 space-y-3 text-[15px]">
            {[
              'Careful, hands-on mastering by an experienced engineer',
              'A more polished finish, tailored to your song',
              'Your finished master delivered by email within hours',
            ].map((item) => <li key={item} className="flex items-start gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-good/15 text-[13px] text-good">✓</span><span>{item}</span></li>)}
          </ul>
          <div className="mt-6 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-[13px] text-mute"><span className="text-white">Track:</span> <span className="break-all">{trackName}</span></div>
          <button onClick={() => setStep('email')} className="mt-6 w-full rounded-full bg-glow px-6 py-3.5 text-[15px] font-medium text-ink transition hover:bg-[#e65f0c]">Continue</button>
        </> : <>
          <div className="mt-4 rounded-2xl border border-good/30 bg-good/[0.08] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-good/15 text-[14px] text-good">✓</span>
              <p className="text-[15px] font-medium leading-6 text-white">An experienced mastering engineer will master your song and email the finished master to this address within a few hours.</p>
            </div>
          </div>
          <label className="mt-5 block text-[13px] text-mute" htmlFor="manual-mastering-email">Email address</label>
          <input id="manual-mastering-email" autoFocus type="email" autoComplete="email" value={email} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'manual-mastering-email-error' : undefined} onChange={(e) => { setEmail(e.target.value); setEmailError(null) }} placeholder="you@example.com" className={`mt-2 w-full rounded-xl border bg-black/30 px-4 py-3 text-[15px] text-white outline-none transition placeholder:text-mute/60 focus:border-glow/70 ${emailError ? 'border-bad/70' : 'border-line'}`} />
          {emailError && <p id="manual-mastering-email-error" role="alert" className="mt-2 text-[13px] text-bad">{emailError}</p>}
          <p className="mt-3 min-h-5 text-[13px] text-mute">{validEmail ? `One-time payment · ${currency === 'EUR' ? '€9.99' : '$9.99'}` : 'Your email is only used for this mastering request.'}</p>
          <button onClick={() => { if (!validEmail) { setEmailError('Please enter your email first.'); document.getElementById('manual-mastering-email')?.focus(); return } setEmailError(null); window.open(PAYPAL_LINKS[currency], '_blank', 'noopener,noreferrer') }} className="mt-3 w-full rounded-full bg-glow px-6 py-3.5 text-[15px] font-medium text-ink transition hover:bg-[#e65f0c]">Confirm &amp; Pay {currency === 'EUR' ? '€9.99' : '$9.99'}</button>
          <button onClick={() => setStep('details')} className="mt-4 w-full py-2 text-[13px] text-mute transition hover:text-white">Back</button>
        </>}
      </section>
    </div>
  )
}
