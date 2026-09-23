-- Calisthenics Logbook — run this once in Supabase: SQL Editor → New query → paste → Run.
-- Creates one table for all your logs and a private bucket for progress photos.
-- Row Level Security makes sure a signed-in user can only ever see and change their own rows and photos.

create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

alter table public.docs enable row level security;
grant select, insert, update, delete on public.docs to authenticated;

drop policy if exists "docs: read own"   on public.docs;
drop policy if exists "docs: add own"    on public.docs;
drop policy if exists "docs: change own" on public.docs;
drop policy if exists "docs: delete own" on public.docs;
create policy "docs: read own"   on public.docs for select to authenticated using (auth.uid() = user_id);
create policy "docs: add own"    on public.docs for insert to authenticated with check (auth.uid() = user_id);
create policy "docs: change own" on public.docs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "docs: delete own" on public.docs for delete to authenticated using (auth.uid() = user_id);

-- Private photo bucket; each user's photos live in a folder named after their user id.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos: read own"   on storage.objects;
drop policy if exists "photos: add own"    on storage.objects;
drop policy if exists "photos: change own" on storage.objects;
drop policy if exists "photos: delete own" on storage.objects;
create policy "photos: read own"   on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: add own"    on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: change own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
