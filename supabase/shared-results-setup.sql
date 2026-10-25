-- Run once in the Supabase SQL Editor to enable publicly shareable results.
-- Anyone with a share URL can read its row and the public audio objects.

create table if not exists public.shared_results (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,69}-[a-f0-9]{6}$'),
  title text not null check (length(title) between 1 and 80),
  original_file_name text not null check (length(original_file_name) between 1 and 180),
  mastered_file_name text not null check (length(mastered_file_name) between 1 and 180),
  original_path text not null,
  mastered_path text not null,
  peaks_before jsonb not null check (jsonb_typeof(peaks_before) = 'array' and jsonb_array_length(peaks_before) <= 12000),
  peaks_after jsonb not null check (jsonb_typeof(peaks_after) = 'array' and jsonb_array_length(peaks_after) <= 12000),
  created_at timestamptz not null default now(),
  check (original_path = slug || '/original.wav' or original_path = slug || '/original.mp3'),
  check (mastered_path = slug || '/mastered.mp3')
);

alter table public.shared_results enable row level security;
revoke all on public.shared_results from public, anon, authenticated;
grant select, insert on public.shared_results to anon, authenticated;

drop policy if exists "Anyone can view shared result metadata" on public.shared_results;
create policy "Anyone can view shared result metadata"
  on public.shared_results for select to anon, authenticated
  using (true);

drop policy if exists "Anyone can create a shared result record" on public.shared_results;
create policy "Anyone can create a shared result record"
  on public.shared_results for insert to anon, authenticated
  with check (
    slug ~ '^[a-z0-9][a-z0-9-]{0,69}-[a-f0-9]{6}$'
    and original_path like slug || '/original.%'
    and mastered_path = slug || '/mastered.mp3'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'share-results', 'share-results', true, 52428800,
  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allow uploads to shared-results bucket" on storage.objects;
create policy "Allow uploads to shared-results bucket"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'share-results'
    and name ~* '^[a-z0-9][a-z0-9-]{0,69}-[a-f0-9]{6}/(original\.(wav|mp3)|mastered\.mp3)$'
    and storage.extension(name) in ('wav', 'mp3')
  );
