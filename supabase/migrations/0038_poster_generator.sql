-- Migration 0038: the Poster Generator add-on (26 Nov 2026).
-- £4.99 a month for the whole account (not per site), or £50.90 a year upfront (worked out by 0037). Bought like the other add-ons;
-- the page itself is only handed out by the server to a signed-in business that owns it.
insert into extras(code, name, description, price_pence, charged_per) values
  ('posters', 'Poster Generator', 'Make branded posters from 17 ready-made templates for pubs, cafés, shops, seasonal offers and notices, with your own logo, colours and QR codes. Download as PNG or PDF. One price for your whole account.', 499, 'company')
on conflict (code) do nothing;
