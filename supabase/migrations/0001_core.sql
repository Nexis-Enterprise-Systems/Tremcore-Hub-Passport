-- TREMCORE Compliance Passport — core schema (migration 0001)
-- Permissions are enforced HERE (row-level security), never only in the UI.
-- Levels: 1 Self-Managed, 2 Managed Compliance, 3 Property & Compliance Managed.

create extension if not exists pgcrypto;

-- ───────────────────────── enums ─────────────────────────
create type user_role as enum ('tremcore_admin', 'tremcore_staff', 'client_super', 'client_site');
create type site_perm as enum ('view', 'update', 'full');
create type sub_status as enum ('trial', 'active', 'past_due', 'cancelled');
create type basis_type as enum ('legal', 'standard', 'best_practice');
create type renewal_stage as enum ('due_soon', 'booking_required', 'booked', 'completed');
create type job_priority as enum ('low', 'normal', 'high', 'urgent');
create type job_status as enum ('new', 'reviewed', 'contractor_to_be_sourced', 'awaiting_quote_or_approval', 'booked', 'in_progress', 'completed', 'closed_cancelled');

-- ───────────────────────── tables ─────────────────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level smallint not null default 1 check (level between 1 and 3),
  subscription sub_status not null default 'trial',
  monthly_value_pence integer not null default 0 check (monthly_value_pence >= 0),
  require_mfa boolean not null default false,   -- per-client setting for site users
  contact_name text, contact_email text, contact_phone text, address text,
  notes text,
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);
create index on properties(company_id);

-- One profile per auth user. Tremcore staff have company_id null.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role user_role not null,
  company_id uuid references companies(id) on delete cascade,
  perm site_perm not null default 'view',      -- applies to client_site users on Level 1
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint client_has_company check ((role in ('tremcore_admin','tremcore_staff')) = (company_id is null))
);
create index on profiles(company_id);

-- Which sites a site user may see (super users see all sites of their company).
create table profile_properties (
  profile_id uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  primary key (profile_id, property_id)
);

-- Tremcore's library of standard compliance titles; copied into a property's items.
create table category_library (
  id uuid primary key default gen_random_uuid(),
  grp text not null,
  title text not null,
  default_basis basis_type not null default 'standard',
  default_frequency_months smallint,
  unique (grp, title)
);

create table compliance_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  library_id uuid references category_library(id) on delete set null,
  grp text not null default 'Other',
  title text not null,
  basis basis_type not null default 'standard',
  frequency_months smallint check (frequency_months is null or frequency_months > 0),
  last_done date,
  due_date date,                                -- null = not entered (shown as missing, never green)
  notes text not null default '',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on compliance_items(property_id);
create index on compliance_items(due_date);

create table documents (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references compliance_items(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  storage_path text not null unique,            -- {property_id}/{item_id}/{uuid}-{filename}
  filename text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index on documents(item_id);

create table renewal_tasks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references compliance_items(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  stage renewal_stage not null default 'due_soon',
  booked_for date,
  note text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on renewal_tasks(property_id);

create table subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null, trade text, phone text, email text, notes text,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  reported_by uuid references profiles(id),
  priority job_priority not null default 'normal',
  issue_type text not null,
  location text not null,
  description text not null,
  status job_status not null default 'new',
  subcontractor_id uuid references subcontractors(id) on delete set null,
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs(property_id);

create table job_images (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  storage_path text not null unique,
  uploaded_at timestamptz not null default now()
);

-- Site plans and 3D models (JSON from the plan editor) and marker photos live in storage.
create table plans (
  property_id uuid primary key references properties(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  property_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create index on audit_log(property_id, at desc);

-- ───────────────────────── helper functions ─────────────────────────
-- SECURITY DEFINER so they can read profiles/companies without recursing through RLS.

create or replace function auth_profile() returns profiles
language sql stable security definer set search_path = public as $$
  select p.* from profiles p where p.id = auth.uid() and p.active
$$;

create or replace function is_tremcore() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.role in ('tremcore_admin','tremcore_staff'))
$$;

create or replace function is_tremcore_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.role = 'tremcore_admin')
$$;

-- 2FA rule: Tremcore staff and client super users must have passed MFA (aal2).
-- Site users need it only when their company has require_mfa switched on.
create or replace function mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role in ('tremcore_admin','tremcore_staff','client_super') then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      when c.require_mfa then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      else true
    end
    from profiles p left join companies c on c.id = p.company_id
    where p.id = auth.uid() and p.active
  ), false)
$$;

create or replace function is_client_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active and p.role = 'client_super')
$$;

create or replace function my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and active
$$;

-- May the caller SEE this property?
create or replace function can_access_property(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (
    select 1 from profiles p join properties pr on pr.id = pid
    where p.id = auth.uid() and p.active
      and (
        p.role in ('tremcore_admin','tremcore_staff')
        or (p.role = 'client_super' and pr.company_id = p.company_id)
        or (p.role = 'client_site' and pr.company_id = p.company_id
            and exists (select 1 from profile_properties pp where pp.profile_id = p.id and pp.property_id = pid))
      )
  )
$$;

-- May the caller EDIT compliance records at this property?
-- Tremcore: always (Level 2/3 clients are managed by Tremcore; Level 1 can be assisted).
-- Client: ONLY on Level 1, ONLY if their permission is update/full (super users: full).
create or replace function can_edit_property(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_property(pid) and exists (
    select 1 from profiles p join properties pr on pr.id = pid join companies c on c.id = pr.company_id
    where p.id = auth.uid() and p.active
      and (
        p.role in ('tremcore_admin','tremcore_staff')
        or (c.level = 1 and (p.role = 'client_super' or p.perm in ('update','full')))
      )
  )
$$;

-- May the caller delete records / change categories at this property? (Level 1 'full' or super user, or Tremcore.)
create or replace function can_manage_property(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_property(pid) and exists (
    select 1 from profiles p join properties pr on pr.id = pid join companies c on c.id = pr.company_id
    where p.id = auth.uid() and p.active
      and (
        p.role in ('tremcore_admin','tremcore_staff')
        or (c.level = 1 and (p.role = 'client_super' or p.perm = 'full'))
      )
  )
$$;

-- May the caller raise a reactive job at this property? Level 3 clients only (Tremcore may log one on their behalf).
create or replace function can_raise_job(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_access_property(pid) and exists (
    select 1 from profiles p join properties pr on pr.id = pid join companies c on c.id = pr.company_id
    where p.id = auth.uid() and p.active
      and (p.role in ('tremcore_admin','tremcore_staff') or c.level = 3)
  )
$$;

-- ───────────────────────── row-level security ─────────────────────────
alter table companies         enable row level security;
alter table properties        enable row level security;
alter table profiles          enable row level security;
alter table profile_properties enable row level security;
alter table category_library  enable row level security;
alter table compliance_items  enable row level security;
alter table documents         enable row level security;
alter table renewal_tasks     enable row level security;
alter table subcontractors    enable row level security;
alter table jobs              enable row level security;
alter table job_images        enable row level security;
alter table plans             enable row level security;
alter table audit_log         enable row level security;

-- companies: Tremcore sees/manages all; clients see only their own (read-only).
create policy companies_read on companies for select
  using (mfa_ok() and (is_tremcore() or id = my_company()));
create policy companies_write on companies for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- properties
create policy properties_read on properties for select using (can_access_property(id));
create policy properties_write on properties for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- profiles: you can read yourself; super users read their company's users; Tremcore reads all.
create policy profiles_read on profiles for select using (
  id = auth.uid()
  or (mfa_ok() and is_tremcore())
  or (mfa_ok() and company_id is not null and company_id = my_company()
      and is_client_super())
);
create policy profiles_write on profiles for all
  using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());

create policy profile_properties_read on profile_properties for select using (
  profile_id = auth.uid() or (mfa_ok() and is_tremcore())
);
create policy profile_properties_write on profile_properties for all
  using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());

-- library: any signed-in user may read; only Tremcore edits.
create policy library_read on category_library for select using (auth.uid() is not null);
create policy library_write on category_library for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- compliance items
create policy items_read   on compliance_items for select using (can_access_property(property_id));
create policy items_insert on compliance_items for insert with check (can_manage_property(property_id));
create policy items_update on compliance_items for update
  using (can_edit_property(property_id)) with check (can_edit_property(property_id));
create policy items_delete on compliance_items for delete using (can_manage_property(property_id));

-- documents
create policy docs_read   on documents for select using (can_access_property(property_id));
create policy docs_insert on documents for insert with check (can_edit_property(property_id));
create policy docs_delete on documents for delete using (can_manage_property(property_id));

-- renewal tasks: Tremcore works them; clients can read (so they see "Tremcore is managing this").
create policy renewals_read  on renewal_tasks for select using (can_access_property(property_id));
create policy renewals_write on renewal_tasks for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- subcontractors: Tremcore only.
create policy subs_all on subcontractors for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- jobs: clients see their sites' jobs and may raise one on Level 3; only Tremcore updates them.
create policy jobs_read   on jobs for select using (can_access_property(property_id));
create policy jobs_insert on jobs for insert with check (can_raise_job(property_id) and reported_by = auth.uid());
create policy jobs_update on jobs for update
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());
create policy jobs_delete on jobs for delete using (mfa_ok() and is_tremcore_admin());

create policy job_images_read   on job_images for select using (can_access_property(property_id));
create policy job_images_insert on job_images for insert with check (can_raise_job(property_id));
create policy job_images_delete on job_images for delete using (mfa_ok() and is_tremcore());

-- plans: everyone with access reads; editing follows record-edit rights.
create policy plans_read   on plans for select using (can_access_property(property_id));
create policy plans_insert on plans for insert with check (can_edit_property(property_id));
create policy plans_update on plans for update
  using (can_edit_property(property_id)) with check (can_edit_property(property_id));

-- audit log: readable by those who can see the property; written only by triggers.
create policy audit_read on audit_log for select using (property_id is not null and can_access_property(property_id));

-- Tremcore's private job notes live in their own table so clients can never read them.
create table job_internal (
  job_id uuid primary key references jobs(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table job_internal enable row level security;
create policy job_internal_all on job_internal for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- ───────────────────────── triggers ─────────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger items_touch    before update on compliance_items for each row execute function touch_updated_at();
create trigger renewals_touch before update on renewal_tasks    for each row execute function touch_updated_at();
create trigger jobs_touch     before update on jobs             for each row execute function touch_updated_at();

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; pid uuid;
begin
  rec := to_jsonb(coalesce(new, old));
  pid := nullif(rec ->> 'property_id', '')::uuid;
  insert into audit_log(actor, property_id, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), pid, tg_table_name, (rec ->> 'id')::uuid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger items_audit    after insert or update or delete on compliance_items for each row execute function audit_row();
create trigger docs_audit     after insert or delete           on documents        for each row execute function audit_row();
create trigger renewals_audit after insert or update or delete on renewal_tasks    for each row execute function audit_row();
create trigger jobs_audit     after insert or update or delete on jobs             for each row execute function audit_row();

-- ───────────────────────── traffic-light status ─────────────────────────
-- green: > 30 days to due date · amber: due within 30 days · red: past due · missing: no date entered (never green).
create or replace view compliance_status with (security_invoker = on) as
select i.*,
  case
    when i.due_date is null then 'missing'
    when i.due_date < current_date then 'red'
    when i.due_date <= current_date + 30 then 'amber'
    else 'green'
  end as status,
  (i.due_date - current_date) as days_left
from compliance_items i;

-- Per-property summary used by the dashboard donuts.
-- pct_in_date = (green + amber) / ALL items, so missing dates count against the figure, never for it.
create or replace view property_summary with (security_invoker = on) as
select p.id as property_id, p.company_id, p.name,
  count(s.*) filter (where s.status = 'green')   as green,
  count(s.*) filter (where s.status = 'amber')   as amber,
  count(s.*) filter (where s.status = 'red')     as red,
  count(s.*) filter (where s.status = 'missing') as missing,
  count(s.*)                                     as total,
  case when count(s.*) = 0 then null
       else round(100.0 * count(s.*) filter (where s.status in ('green','amber')) / count(s.*)) end as pct_in_date
from properties p left join compliance_status s on s.property_id = p.id
group by p.id;

-- ───────────────────────── private document storage ─────────────────────────
-- Path convention: {property_id}/{item_id}/{filename}. The first folder drives access.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

create policy documents_read on storage.objects for select
  using (bucket_id = 'documents' and can_access_property(((storage.foldername(name))[1])::uuid));
create policy documents_insert on storage.objects for insert
  with check (bucket_id = 'documents' and can_edit_property(((storage.foldername(name))[1])::uuid));
create policy documents_update on storage.objects for update
  using (bucket_id = 'documents' and can_edit_property(((storage.foldername(name))[1])::uuid));
create policy documents_delete on storage.objects for delete
  using (bucket_id = 'documents' and can_manage_property(((storage.foldername(name))[1])::uuid));

-- Job photos: any user who may raise a job at the property may upload; all with access may read.
insert into storage.buckets (id, name, public) values ('job-images', 'job-images', false) on conflict (id) do nothing;

create policy jobimg_read on storage.objects for select
  using (bucket_id = 'job-images' and can_access_property(((storage.foldername(name))[1])::uuid));
create policy jobimg_insert on storage.objects for insert
  with check (bucket_id = 'job-images' and can_raise_job(((storage.foldername(name))[1])::uuid));
