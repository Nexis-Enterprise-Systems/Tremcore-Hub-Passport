-- Removes ALL offer codes (free access and discount codes), so the Codes list in the Hub is empty.
-- Run once in the Supabase SQL editor (Live). Cannot be undone.
-- Codes already used have done their job; companies are not touched by this.
delete from public.offer_codes;

-- Check: should show 0.
select count(*) as codes_left from public.offer_codes;
