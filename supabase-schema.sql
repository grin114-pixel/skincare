create extension if not exists pgcrypto;

create table if not exists public.skincare_app_settings (
  id text primary key default 'global',
  pin_hash text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.skincare_records (
  id uuid primary key default gen_random_uuid(),
  record_date date not null,
  procedure_name text not null default '',
  dosage_memo text not null default '',
  hospital text not null default '',
  amount text not null default '',
  session_memo text not null default '',
  content text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.skincare_app_settings enable row level security;
alter table public.skincare_records enable row level security;

drop policy if exists "Allow anonymous read skincare app settings" on public.skincare_app_settings;
create policy "Allow anonymous read skincare app settings"
  on public.skincare_app_settings
  for select
  to anon
  using (true);

drop policy if exists "Allow anonymous write skincare app settings" on public.skincare_app_settings;
create policy "Allow anonymous write skincare app settings"
  on public.skincare_app_settings
  for insert
  to anon
  with check (true);

drop policy if exists "Allow anonymous update skincare app settings" on public.skincare_app_settings;
create policy "Allow anonymous update skincare app settings"
  on public.skincare_app_settings
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow anonymous read skincare records" on public.skincare_records;
create policy "Allow anonymous read skincare records"
  on public.skincare_records
  for select
  to anon
  using (true);

drop policy if exists "Allow anonymous insert skincare records" on public.skincare_records;
create policy "Allow anonymous insert skincare records"
  on public.skincare_records
  for insert
  to anon
  with check (true);

drop policy if exists "Allow anonymous update skincare records" on public.skincare_records;
create policy "Allow anonymous update skincare records"
  on public.skincare_records
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow anonymous delete skincare records" on public.skincare_records;
create policy "Allow anonymous delete skincare records"
  on public.skincare_records
  for delete
  to anon
  using (true);
