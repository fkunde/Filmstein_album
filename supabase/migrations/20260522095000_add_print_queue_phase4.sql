create table if not exists public.print_queue_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid not null references public.project_folders(id) on delete cascade,
  photo_id text not null references public.photos(global_photo_id) on delete cascade,
  print_code_snapshot text null,
  requested_copies integer not null default 1,
  completed_copies integer not null default 0,
  status text not null default 'queued',
  source_mode text not null default 'manual',
  source_reason text not null default 'admin_click',
  error_message text null,
  created_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint print_queue_items_requested_copies_check check (requested_copies >= 1),
  constraint print_queue_items_completed_copies_check check (completed_copies >= 0 and completed_copies <= requested_copies),
  constraint print_queue_items_status_check check (status in ('queued', 'printing', 'completed', 'cancelled', 'failed')),
  constraint print_queue_items_source_mode_check check (source_mode in ('manual', 'semi_auto', 'auto')),
  constraint print_queue_items_source_reason_check check (source_reason in ('admin_click', 'new_upload', 'ftp_route', 'customer_upload'))
);

create index if not exists print_queue_items_project_folder_status_idx
  on public.print_queue_items(project_id, folder_id, status, created_at desc);

create index if not exists print_queue_items_photo_created_idx
  on public.print_queue_items(photo_id, created_at desc);

create or replace function public.set_print_queue_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_print_queue_items_updated_at on public.print_queue_items;
create trigger set_print_queue_items_updated_at
before update on public.print_queue_items
for each row
execute function public.set_print_queue_items_updated_at();
