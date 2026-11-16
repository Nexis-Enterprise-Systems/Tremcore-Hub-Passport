-- What may the signed-in person do in the passport? The screen uses this only to decide which buttons to show.
-- The real protection is still the row-level rules on compliance_items, documents and storage (can_edit_property / can_manage_property).
-- can_edit   = change dates, notes and certificates.   can_manage = also add and remove checks and delete certificates.
create or replace function passport_rights()
returns table (can_edit boolean, can_manage boolean)
language sql stable security definer set search_path = public as $$
  select
    (p.role in ('tremcore_admin','tremcore_staff')) or (c.level = 1 and (p.role = 'client_super' or p.perm in ('update','full'))),
    (p.role in ('tremcore_admin','tremcore_staff')) or (c.level = 1 and (p.role = 'client_super' or p.perm = 'full'))
  from profiles p left join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active
$$;
revoke all on function passport_rights() from public, anon;
grant execute on function passport_rights() to authenticated;
