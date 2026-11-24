-- Migration 0035: add-on prices, as shown on the website home page (24 Nov 2026).
-- Toolbox Talks £2.99 and Staff Clock In / Out £5.99, each per site per month (+ VAT), for people who have the Tremcore app.
-- Only the price for NEW purchases changes. Add-ons already bought keep the price they were bought at (company_extras.price_pence).
update extras set price_pence = 299 where code = 'toolbox_talks';
update extras set price_pence = 599 where code = 'staff_signin';
