/**
 * Example Stripe backend (Node + Express). Not bundled into the website.
 *   npm i express stripe cors
 *   STRIPE_SECRET_KEY=sk_live_… SITE_URL=https://your-site npx tsx server/stripe-checkout.example.ts
 * Then set in the website's .env:
 *   VITE_STRIPE_CHECKOUT_ENDPOINT=https://api.your-site/checkout
 *   VITE_STRIPE_STATUS_ENDPOINT=https://api.your-site/checkout/status
 */
import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const app = express()
app.use(cors({ origin: process.env.SITE_URL }), express.json())

app.post('/checkout', async (req, res) => {
  const quantity = Math.max(1, Math.min(200, Number(req.body.quantity) || 1))
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity, price_data: { currency: 'eur', unit_amount: 199, product_data: { name: 'Mastered track' } } }],
    success_url: `${process.env.SITE_URL}/checkout-done.html`,
    cancel_url: `${process.env.SITE_URL}/checkout-done.html`,
  })
  res.json({ url: session.url, sessionId: session.id })
})

app.get('/checkout/status', async (req, res) => {
  const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id))
  res.json({ paid: s.payment_status === 'paid' })
})

app.listen(Number(process.env.PORT) || 8787)
