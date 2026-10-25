-- Fix uploads to the public share-results bucket.
-- Storage checks this INSERT policy before the final object metadata is written,
-- so metadata->>'size' is not available here. The bucket's file_size_limit is
-- the authoritative 50 MB enforcement; this policy restricts bucket and path.

update storage.buckets
set public = true,
    file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']
where id = 'share-results';

drop policy if exists "Allow uploads to shared-results bucket" on storage.objects;
create policy "Allow uploads to shared-results bucket"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'share-results'
    and name ~* '^[a-z0-9][a-z0-9-]{0,69}-[a-f0-9]{6}/(original\.(wav|mp3)|mastered\.mp3)$'
    and storage.extension(name) in ('wav', 'mp3')
  );
