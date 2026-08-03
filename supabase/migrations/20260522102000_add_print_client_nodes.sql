create table if not exists public.print_client_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid not null references public.project_folders(id) on delete cascade,
  node_key text not null,
  client_name text null,
  app_version text null,
  platform text null,
  printer_status text not null default 'disconnected',
  node_status text not null default 'offline',
  printer_name text null,
  last_check_at timestamptz null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint print_client_nodes_node_key_check check (char_length(node_key) >= 8),
  constraint print_client_nodes_printer_status_check check (printer_status in ('disconnected', 'unavailable', 'idle', 'printing', 'paused', 'error')),
  constraint print_client_nodes_node_status_check check (node_status in ('offline', 'online', 'degraded'))
);

create unique index if not exists print_client_nodes_folder_node_key_uidx
  on public.print_client_nodes(folder_id, node_key);

create index if not exists print_client_nodes_folder_seen_idx
  on public.print_client_nodes(folder_id, last_seen_at desc);

create or replace function public.set_print_client_nodes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_print_client_nodes_updated_at on public.print_client_nodes;
create trigger set_print_client_nodes_updated_at
before update on public.print_client_nodes
for each row
execute function public.set_print_client_nodes_updated_at();

create or replace function public.print_client_request_token()
returns text
language plpgsql
stable
as $$
declare
  headers jsonb;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    headers := '{}'::jsonb;
  end;

  return nullif(coalesce(
    headers ->> 'x-print-client-token',
    headers ->> 'X-Print-Client-Token'
  ), '');
end;
$$;

create or replace function public.print_client_token_allows_folder(
  input_project_id uuid,
  input_folder_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_folders pf
    where pf.id = input_folder_id
      and pf.project_id = input_project_id
      and pf.folder_kind = 'print'
      and pf.settings -> 'print' ->> 'client_token' = public.print_client_request_token()
  );
$$;

revoke all on function public.print_client_request_token() from public;
revoke all on function public.print_client_token_allows_folder(uuid, uuid) from public;
grant execute on function public.print_client_request_token() to anon, authenticated, service_role;
grant execute on function public.print_client_token_allows_folder(uuid, uuid) to anon, authenticated, service_role;

grant select, insert, update on table public.print_client_nodes to anon, authenticated, service_role;
alter table public.print_client_nodes enable row level security;

drop policy if exists print_client_nodes_select_by_client_token on public.print_client_nodes;
create policy print_client_nodes_select_by_client_token
  on public.print_client_nodes
  for select
  to anon, authenticated
  using (public.print_client_token_allows_folder(project_id, folder_id));

drop policy if exists print_client_nodes_insert_by_client_token on public.print_client_nodes;
create policy print_client_nodes_insert_by_client_token
  on public.print_client_nodes
  for insert
  to anon, authenticated
  with check (public.print_client_token_allows_folder(project_id, folder_id));

drop policy if exists print_client_nodes_update_by_client_token on public.print_client_nodes;
create policy print_client_nodes_update_by_client_token
  on public.print_client_nodes
  for update
  to anon, authenticated
  using (public.print_client_token_allows_folder(project_id, folder_id))
  with check (public.print_client_token_allows_folder(project_id, folder_id));
