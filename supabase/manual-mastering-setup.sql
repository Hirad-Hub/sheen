-- Run once in the Supabase SQL Editor before enabling the request form.
-- Requests and audio stay private. Visitors must verify their email through
-- Supabase Auth before they can upload audio or submit a request.

create table if not exists public.manual_mastering_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (length(email) between 5 and 254),
  file_name text not null check (length(file_name) between 1 and 255),
  file_path text not null unique,
  status text not null default 'new' check (status in ('new', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.manual_mastering_requests
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.manual_mastering_requests enable row level security;
revoke all on public.manual_mastering_requests from public, anon, authenticated;
grant insert on public.manual_mastering_requests to authenticated;

drop policy if exists "Public can submit mastering requests" on public.manual_mastering_requests;
drop policy if exists "Verified users can submit mastering requests" on public.manual_mastering_requests;
create policy "Verified users can submit mastering requests"
  on public.manual_mastering_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and lower(email) = lower((select auth.jwt()->>'email'))
    and status = 'new'
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and file_path like (select auth.uid()::text) || '/%'
    and file_path ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}/[^/]+\.(wav|wave|mp3)$'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mastering-uploads',
  'mastering-uploads',
  false,
  524288000,
  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can upload audio for mastering requests" on storage.objects;
drop policy if exists "Verified users can upload audio for mastering requests" on storage.objects;
create policy "Verified users can upload audio for mastering requests"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mastering-uploads'
    and storage.extension(name) in ('wav', 'wave', 'mp3')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and name ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}/[^/]+\.(wav|wave|mp3)$'
  );
