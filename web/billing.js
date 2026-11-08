'use strict';
// Stripe helpers, kept free of network calls so they can be tested on their own.
// Prices are in pence and exclude VAT. They match the sign-up page and the database (migration 0014).
const crypto = require('crypto');

const PRICES = { monthly: [1499, 799], annual: [15290, 8150] };   // [first site, each extra site]

// The form fields Stripe wants for a subscription Checkout page. The prices are written into the request itself, so nothing needs setting up in the Stripe dashboard.
function checkoutParams({ companyId, sites, interval, email, origin, methods }) {
  const p = PRICES[interval];
  if (!p || !companyId || !(sites >= 1 && sites <= 100)) throw new Error('bad checkout details');
  const per = interval === 'annual' ? 'year' : 'month';
  const q = new URLSearchParams();
  q.set('mode', 'subscription');
  q.set('client_reference_id', companyId);
  if (email) q.set('customer_email', email);
  q.set('metadata[company_id]', companyId);
  q.set('subscription_data[metadata][company_id]', companyId);
  const lines = [['Compliance Passport: first site', p[0], 1]];
  if (sites > 1) lines.push(['Compliance Passport: extra site', p[1], sites - 1]);
  lines.forEach(([name, amount, qty], i) => {
    q.set(`line_items[${i}][quantity]`, String(qty));
    q.set(`line_items[${i}][price_data][currency]`, 'gbp');
    q.set(`line_items[${i}][price_data][unit_amount]`, String(amount));
    q.set(`line_items[${i}][price_data][recurring][interval]`, per);
    q.set(`line_items[${i}][price_data][product_data][name]`, name);
  });
  // Stripe now picks payment methods from the Dashboard settings; only send a list if one was set on purpose.
  (methods || []).forEach((m, i) => q.set(`payment_method_types[${i}]`, m));
  q.set('success_url', origin + '/app/?paid=1');
  q.set('cancel_url', origin + '/app/?paid=0');
  return q;
}

// Stripe signs every message it sends us. Anything that does not verify is thrown away.
function verifySignature(rawBody, header, secret, nowSeconds, toleranceSeconds) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map((s) => s.trim().split('='));
  const t = (parts.find((x) => x[0] === 't') || [])[1];
  const sigs = parts.filter((x) => x[0] === 'v1').map((x) => x[1]);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs((nowSeconds == null ? Date.now() / 1000 : nowSeconds) - Number(t)) > (toleranceSeconds || 300)) return false;
  const want = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

// What a verified Stripe event means for us. null = nothing to do.
// Newer Stripe versions moved the subscription id on an invoice; accept both places.
function invoiceSubscription(o) {
  return o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription) || null;
}

function eventToAction(ev) {
  if (!ev || !ev.id || !ev.type || !ev.data || !ev.data.object) return null;
  const o = ev.data.object;
  const base = { eventId: ev.id, type: ev.type, company: null, customer: o.customer || null, subscription: null };
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      // Card payments are paid straight away. Direct Debit says 'unpaid' until the money clears, then sends async_payment_succeeded.
      if (o.payment_status !== 'paid') return null;
      return Object.assign(base, { action: 'paid', company: o.client_reference_id || (o.metadata && o.metadata.company_id) || null, subscription: o.subscription || null });
    case 'invoice.paid':
      return Object.assign(base, { action: 'paid', subscription: invoiceSubscription(o) });
    case 'invoice.payment_failed':
      return Object.assign(base, { action: 'failed', subscription: invoiceSubscription(o) });
    case 'customer.subscription.deleted':
      return Object.assign(base, { action: 'cancelled', customer: o.customer || null, subscription: o.id || null });
    default:
      return null;
  }
}

module.exports = { PRICES, checkoutParams, verifySignature, eventToAction };
