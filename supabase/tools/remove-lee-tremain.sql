-- Removes Lee Tremain from the "Register your interest" list. Run once in the Supabase SQL editor (Live).
delete from public.interest_list where lower(email) = 'leetremain@yahoo.co.uk';

-- Check: the list that is left.
select name, email, business_name, status from public.interest_list order by created_at;
