import { useEffect, useRef, useState } from 'react'
import { formatTotal, payForTracks, paymentsConfigured, testUnlockAvailable } from '../payments/checkout'

interface Props { count: number; onClose: () => void; onPaid: () => void }

export default function CheckoutModal({ count, onClose, onPaid }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => () => ctrl.current?.abort(), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [busy, onClose])

  const pay = async () => {
    setErr(null); setBusy(true)
    ctrl.current = new AbortController()
    try { await payForTracks(count, ctrl.current.signal); onPaid() } catch (e) { setErr(e instanceof Error ? e.message : 'Payment failed.') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="co-title" className="w-full max-w-sm rounded-3xl border border-line bg-raised p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 id="co-title" className="text-lg font-medium">Download your album</h3>
        <p className="mt-1 text-sm text-mute">{count} mastered tracks, delivered as one ZIP file.</p>
        <div className="mt-6 flex items-baseline justify-between border-y border-line py-5">
          <span className="text-sm text-mute">Total</span>
          <span className="num text-3xl font-medium">{formatTotal(count)}</span>
        </div>
        <ul className="mt-5 space-y-2 text-sm text-mute">
          <li>One-time payment · no subscription</li>
          <li>Secure checkout by Stripe</li>
        </ul>
        {err && <p className="mt-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
        {paymentsConfigured ? (
          <button disabled={busy} onClick={pay} className="mt-6 w-full rounded-full bg-glow py-3.5 font-medium text-ink transition hover:bg-glow-soft disabled:opacity-60">
            {busy ? 'Waiting for payment…' : `Pay ${formatTotal(count)}`}
          </button>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-mute">Payments aren't connected yet. Add your Stripe endpoints to enable checkout (see README).</p>
            {testUnlockAvailable && (
              <button onClick={onPaid} className="w-full rounded-full border border-line py-3 text-sm transition hover:bg-white/5">Test mode: unlock download</button>
            )}
          </div>
        )}
        <button disabled={busy} onClick={onClose} className="mt-3 w-full py-2 text-sm text-mute hover:text-white">Cancel</button>
      </div>
    </div>
  )
}
