/**
 * Stripe checkout integration point. Configure with env vars (see README):
 *   VITE_STRIPE_CHECKOUT_ENDPOINT — POST {quantity} → { url, sessionId } (Stripe Checkout Session)
 *   VITE_STRIPE_STATUS_ENDPOINT   — GET ?session_id=… → { paid: boolean }
 * The secret key lives only on the server (see server/stripe-checkout.example.ts).
 */
export const PRICE_PER_TRACK_EUR = 1.99

const CHECKOUT = import.meta.env.VITE_STRIPE_CHECKOUT_ENDPOINT as string | undefined
const STATUS = import.meta.env.VITE_STRIPE_STATUS_ENDPOINT as string | undefined
export const paymentsConfigured = Boolean(CHECKOUT && STATUS)
/** Test unlock is only available in local development and only while Stripe is not configured. */
export const testUnlockAvailable = !paymentsConfigured && import.meta.env.DEV

export function formatTotal(count: number) {
  const cents = Math.round(PRICE_PER_TRACK_EUR * 100) * count
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

/** Opens Stripe Checkout in a popup window and resolves once the session reports paid. */
export async function payForTracks(quantity: number, signal: AbortSignal): Promise<void> {
  if (!paymentsConfigured) throw new Error('Payments are not connected yet.')
  const popup = window.open('', 'stripe-checkout', 'width=480,height=720')
  const res = await fetch(CHECKOUT!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }) })
  if (!res.ok) { popup?.close(); throw new Error('Could not start checkout. Please try again.') }
  const { url, sessionId } = (await res.json()) as { url: string; sessionId: string }
  if (popup) popup.location.href = url
  else window.open(url, 'stripe-checkout', 'width=480,height=720')
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 2000))
    const s = await fetch(`${STATUS}?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()).catch(() => null)
    if (s?.paid) { popup?.close(); return }
    if (popup && popup.closed) {
      const last = await fetch(`${STATUS}?session_id=${encodeURIComponent(sessionId)}`).then((r) => r.json()).catch(() => null)
      if (last?.paid) return
      throw new Error('Checkout was closed before payment completed.')
    }
  }
  throw new Error('Checkout cancelled.')
}
