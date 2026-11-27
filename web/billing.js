'use strict';
// Stripe helpers, kept free of network calls so they can be tested on their own.
// Prices are in pence and exclude VAT. They match the sign-up page and the database (migration 0014).
const crypto = require('crypto');

const PRICES = { monthly: [1499, 799], annual: [15290, 8150] };   // [first site, each extra site]

// The form fields Stripe wants for a subscription Checkout page. The prices are written into the request itself, so nothing needs setting up in the Stripe dashboard.
// The introductory offer is a Stripe coupon: a fixed amount off every monthly invoice for a set number of months. When the months run out the
// discount just stops and the normal price carries on, so nothing has to be changed by hand after 12 months.
const offerCouponId = (o) => 'tc-intro-' + o.pence + '-' + o.months + 'm';
function couponParams(o) {
  const q = new URLSearchParams();
  q.set('id', offerCouponId(o)); q.set('name', 'Tremcore introductory offer');
  q.set('amount_off', String(o.pence)); q.set('currency', 'gbp'); q.set('duration', 'repeating'); q.set('duration_in_months', String(o.months));
  return q;
}

function checkoutParams({ companyId, sites, interval, email, origin, methods, welcome, offer }) {
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
  if (offer && interval === 'monthly' && offer.pence > 0 && offer.months > 0) q.set('discounts[0][coupon]', offerCouponId(offer));
  // Stripe now picks payment methods from the Dashboard settings; only send a list if one was set on purpose.
  (methods || []).forEach((m, i) => q.set(`payment_method_types[${i}]`, m));
  // A brand-new sign-up pays before confirming their email, so they come back signed out: "welcome" pages explain the next step.
  q.set('success_url', origin + (welcome ? '/app/?welcome=1' : '/app/?paid=1'));
  q.set('cancel_url', origin + (welcome ? '/app/?welcome=0' : '/app/?paid=0'));
  return q;
}

// Tremcore Managed: one monthly line, the price Tremcore set for each site times the number of sites. No discount coupon. Opens every add-on when it is paid (done by the database).
function managedCheckoutParams({ companyId, sites, perSitePence, email, origin, methods, welcome }) {
  if (!companyId || !(sites >= 1 && sites <= 100) || !(Number.isInteger(perSitePence) && perSitePence >= 1 && perSitePence <= 100000)) throw new Error('bad checkout details');
  const q = new URLSearchParams();
  q.set('mode', 'subscription');
  q.set('client_reference_id', companyId);
  if (email) q.set('customer_email', email);
  q.set('metadata[company_id]', companyId);
  q.set('subscription_data[metadata][company_id]', companyId);
  q.set('line_items[0][quantity]', String(sites));
  q.set('line_items[0][price_data][currency]', 'gbp');
  q.set('line_items[0][price_data][unit_amount]', String(perSitePence));
  q.set('line_items[0][price_data][recurring][interval]', 'month');
  q.set('line_items[0][price_data][product_data][name]', 'Tremcore Managed: per site (all add-ons included)');
  (methods || []).forEach((m, i) => q.set(`payment_method_types[${i}]`, m));
  q.set('success_url', origin + (welcome ? '/app/?welcome=1' : '/app/?paid=1'));
  q.set('cancel_url', origin + (welcome ? '/app/?welcome=0' : '/app/?paid=0'));
  return q;
}

// An add-on is its own small subscription, charged monthly (default) or once a year upfront (12 months in one payment, renews every 12 months). The Stripe customer is reused when we already have one, so the card details carry over.
function extraCheckoutParams({ companyId, code, name, unitPence, quantity, customerId, email, origin, interval }) {
  const every = interval === 'year' ? 'year' : 'month';
  if (!companyId || !code || !(unitPence > 0) || !(quantity >= 1 && quantity <= 100)) throw new Error('bad checkout details');
  const q = new URLSearchParams();
  q.set('mode', 'subscription');
  q.set('client_reference_id', companyId);
  if (customerId) q.set('customer', customerId); else if (email) q.set('customer_email', email);
  for (const pre of ['metadata', 'subscription_data[metadata]']) {
    q.set(pre + '[company_id]', companyId); q.set(pre + '[kind]', 'extra'); q.set(pre + '[extra_code]', code); q.set(pre + '[quantity]', String(quantity)); q.set(pre + '[interval]', every);
  }
  q.set('line_items[0][quantity]', String(quantity));
  q.set('line_items[0][price_data][currency]', 'gbp');
  q.set('line_items[0][price_data][unit_amount]', String(unitPence));
  q.set('line_items[0][price_data][recurring][interval]', every);
  q.set('line_items[0][price_data][product_data][name]', name);
  q.set('success_url', origin + '/app/?extra=' + encodeURIComponent(code) + '&paid=1');
  q.set('cancel_url', origin + '/app/?extra=' + encodeURIComponent(code) + '&paid=0');
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
      if (o.metadata && o.metadata.kind === 'extra') {
        const qty = parseInt(o.metadata.quantity, 10);
        return Object.assign(base, { action: 'extra_paid', company: o.client_reference_id || o.metadata.company_id || null, subscription: o.subscription || null, extra: o.metadata.extra_code || null, quantity: qty >= 1 ? qty : 1, interval: o.metadata.interval === 'year' ? 'year' : 'month' });
      }
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

module.exports = { PRICES, offerCouponId, couponParams, checkoutParams, managedCheckoutParams, extraCheckoutParams, verifySignature, eventToAction };
