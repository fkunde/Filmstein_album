alter table public.ftp_ingest_import_jobs
  add column if not exists error_message text null;
