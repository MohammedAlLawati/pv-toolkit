-- PV Toolkit cloud storage (Supabase). Run once in the project's SQL Editor.
--
-- Every record the app keeps in the browser (clients, projects, offers, library, settings, ...)
-- is mirrored as one row here: (store, rid) is the browser store and the record's id, `data`
-- the record itself. Uploaded files (datasheets, logos, reports) go in the private "files"
-- bucket under <user id>/<file id>; their row holds the name and type.
--
-- Each row belongs to the signed-in user who wrote it, and the rules below let a user see and
-- change only their own rows and files. (For a shared team later: add a workspace column and
-- base the rules on membership instead of user_id.)

create table if not exists public.records (
  user_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store     text        not null,
  rid       text        not null,
  data      jsonb,
  deleted   boolean     not null default false,
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, store, rid)
);
create index if not exists records_user_server_at on public.records (user_id, server_at);

-- the server stamps every write, so each browser can ask for "everything since I last looked"
create or replace function public.records_stamp() returns trigger language plpgsql as $$
begin
  new.server_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();

alter table public.records enable row level security;
drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- files: a private bucket, one folder per user
insert into storage.buckets (id, name, public) values ('files', 'files', false)
  on conflict (id) do nothing;
drop policy if exists "own files" on storage.objects;
create policy "own files" on storage.objects for all to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
