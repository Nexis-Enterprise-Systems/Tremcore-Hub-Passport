-- Migration 0009: extras can be priced per company or per site. Staff Sign In/Out is £6.99 per site per month.
-- Toolbox Talks stays £3.99 per company per month.
alter table extras add column charged_per text not null default 'company' check (charged_per in ('company', 'site'));
alter table company_extras add column quantity int not null default 1 check (quantity >= 1);
update extras set price_pence = 699, charged_per = 'site' where code = 'staff_signin';
-- Existing rows keep the price they were sold at.
