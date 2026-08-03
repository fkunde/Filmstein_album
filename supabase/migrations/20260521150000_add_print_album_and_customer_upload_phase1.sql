alter table public.project_folders
  add column if not exists folder_kind text not null default 'standard',
  add column if not exists settings jsonb not null default '{}'::jsonb;

update public.project_folders
set folder_kind = 'standard'
where folder_kind is null or folder_kind not in ('standard', 'print');

alter table public.project_folders
  drop constraint if exists project_folders_folder_kind_check;

alter table public.project_folders
  add constraint project_folders_folder_kind_check
  check (folder_kind in ('standard', 'print'));

alter table public.photos
  add column if not exists upload_source text not null default 'admin',
  add column if not exists customer_public_consent boolean null,
  add column if not exists print_code text null,
  add column if not exists print_count integer not null default 0,
  add column if not exists last_printed_at timestamptz null;

update public.photos
set upload_source = 'admin'
where upload_source is null or upload_source not in ('admin', 'ftp', 'customer_qr');

alter table public.photos
  drop constraint if exists photos_upload_source_check;

alter table public.photos
  add constraint photos_upload_source_check
  check (upload_source in ('admin', 'ftp', 'customer_qr'));

create unique index if not exists photos_print_code_unique_idx
  on public.photos(print_code)
  where print_code is not null;

create index if not exists photos_upload_source_idx
  on public.photos(upload_source);

create index if not exists photos_project_folder_upload_source_idx
  on public.photos(project_id, folder_id, upload_source);

create index if not exists project_folders_folder_kind_idx
  on public.project_folders(project_id, folder_kind);

alter table public.upload_sessions
  add column if not exists upload_source text not null default 'admin',
  add column if not exists customer_public_consent boolean null;

update public.upload_sessions
set upload_source = 'admin'
where upload_source is null or upload_source not in ('admin', 'ftp', 'customer_qr');

alter table public.upload_sessions
  drop constraint if exists upload_sessions_upload_source_check;

alter table public.upload_sessions
  add constraint upload_sessions_upload_source_check
  check (upload_source in ('admin', 'ftp', 'customer_qr'));
