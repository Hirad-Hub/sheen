export type PaymentCurrency = 'EUR' | 'USD'

const EUROPE_LOCALES = new Set(['AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA', 'AL', 'AD', 'BA', 'BY', 'XK'])

export function guessCurrencyFromBrowser(): PaymentCurrency {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  const region = navigator.language.match(/-([A-Za-z]{2})(?:-|$)/)?.[1]?.toUpperCase()
  return timezone.startsWith('Europe/') || (region ? EUROPE_LOCALES.has(region) : false) ? 'EUR' : 'USD'
}

export async function lookupCurrency(signal?: AbortSignal): Promise<PaymentCurrency> {
  const response = await fetch('https://ipapi.co/continent_code/', { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('Location lookup failed')
  return (await response.text()).trim().toUpperCase() === 'EU' ? 'EUR' : 'USD'
}
