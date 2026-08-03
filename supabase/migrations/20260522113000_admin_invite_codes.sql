create extension if not exists pgcrypto;

create table if not exists public.admin_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  role text not null default 'admin',
  is_active boolean not null default true,
  expires_at timestamptz null,
  created_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  used_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint admin_invite_codes_role_check check (role in ('admin', 'super_admin'))
);

create index if not exists admin_invite_codes_created_at_idx
  on public.admin_invite_codes (created_at desc);

insert into public.admin_invite_codes (code, role, is_active)
values ('SF-26-VAULT-9XK7Q2', 'admin', true)
on conflict (code) do nothing;

create or replace function public.register_admin_user(input_username text, input_password text, input_invite_code text)
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text := btrim(input_username);
  normalized_invite_code text := upper(btrim(input_invite_code));
  invite public.admin_invite_codes%rowtype;
  inserted_user public.admin_users%rowtype;
begin
  if normalized_username = '' or coalesce(input_password, '') = '' or normalized_invite_code = '' then
    raise exception 'FIELDS_REQUIRED';
  end if;

  select *
  into invite
  from public.admin_invite_codes aic
  where upper(aic.code) = normalized_invite_code
  for update;

  if invite.id is null
    or invite.is_active is not true
    or invite.used_by_admin_user_id is not null
    or (invite.expires_at is not null and invite.expires_at <= now())
  then
    raise exception 'INVITE_CODE_INVALID';
  end if;

  if exists (
    select 1
    from public.admin_users au
    where lower(au.username) = lower(normalized_username)
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  insert into public.admin_users (username, password, role, is_active)
  values (normalized_username, md5(input_password), invite.role, true)
  returning * into inserted_user;

  update public.admin_invite_codes
  set
    used_by_admin_user_id = inserted_user.id,
    used_at = now(),
    is_active = false
  where id = invite.id;

  return query
  select
    inserted_user.id,
    inserted_user.short_id,
    inserted_user.username,
    inserted_user.is_active,
    inserted_user.role;
end;
$$;

revoke all on function public.register_admin_user(text, text, text) from public;
grant execute on function public.register_admin_user(text, text, text) to anon, authenticated, service_role;

create or replace function public.is_super_admin_user(input_admin_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.id = input_admin_user_id
      and au.is_active = true
      and au.role = 'super_admin'
  );
$$;

revoke all on function public.is_super_admin_user(uuid) from public;
grant execute on function public.is_super_admin_user(uuid) to anon, authenticated, service_role;

create or replace function public.list_admin_invite_codes_for_super_admin(input_requesting_admin_user_id uuid)
returns table (
  id uuid,
  code text,
  role text,
  is_active boolean,
  expires_at timestamptz,
  created_at timestamptz,
  created_by_admin_user_id uuid,
  used_by_admin_user_id uuid,
  used_at timestamptz,
  used_by_username text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_super_admin_user(input_requesting_admin_user_id) is not true then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    aic.id,
    aic.code,
    aic.role,
    aic.is_active,
    aic.expires_at,
    aic.created_at,
    aic.created_by_admin_user_id,
    aic.used_by_admin_user_id,
    aic.used_at,
    used_by.username as used_by_username
  from public.admin_invite_codes aic
  left join public.admin_users used_by
    on used_by.id = aic.used_by_admin_user_id
  order by aic.created_at desc;
end;
$$;

revoke all on function public.list_admin_invite_codes_for_super_admin(uuid) from public;
grant execute on function public.list_admin_invite_codes_for_super_admin(uuid) to anon, authenticated, service_role;

create or replace function public.create_admin_invite_code_for_super_admin(
  input_requesting_admin_user_id uuid,
  input_role text default 'admin'
)
returns table (
  id uuid,
  code text,
  role text,
  is_active boolean,
  expires_at timestamptz,
  created_at timestamptz,
  created_by_admin_user_id uuid,
  used_by_admin_user_id uuid,
  used_at timestamptz,
  used_by_username text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text := case when input_role = 'super_admin' then 'super_admin' else 'admin' end;
  generated_code text;
  inserted_invite public.admin_invite_codes%rowtype;
begin
  if public.is_super_admin_user(input_requesting_admin_user_id) is not true then
    raise exception 'FORBIDDEN';
  end if;

  loop
    generated_code := 'SF-' || upper(encode(gen_random_bytes(5), 'hex'));

    insert into public.admin_invite_codes (code, role, created_by_admin_user_id, is_active)
    values (generated_code, normalized_role, input_requesting_admin_user_id, true)
    on conflict (code) do nothing
    returning * into inserted_invite;

    exit when inserted_invite.id is not null;
  end loop;

  return query
  select
    inserted_invite.id,
    inserted_invite.code,
    inserted_invite.role,
    inserted_invite.is_active,
    inserted_invite.expires_at,
    inserted_invite.created_at,
    inserted_invite.created_by_admin_user_id,
    inserted_invite.used_by_admin_user_id,
    inserted_invite.used_at,
    null::text as used_by_username;
end;
$$;

revoke all on function public.create_admin_invite_code_for_super_admin(uuid, text) from public;
grant execute on function public.create_admin_invite_code_for_super_admin(uuid, text) to anon, authenticated, service_role;

create or replace function public.update_admin_user_for_super_admin(
  input_requesting_admin_user_id uuid,
  input_target_admin_user_id uuid,
  input_role text default null,
  input_is_active boolean default null
)
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text := case
    when input_role = 'super_admin' then 'super_admin'
    when input_role = 'admin' then 'admin'
    else null
  end;
begin
  if public.is_super_admin_user(input_requesting_admin_user_id) is not true then
    raise exception 'FORBIDDEN';
  end if;

  if input_requesting_admin_user_id = input_target_admin_user_id
    and input_is_active is false
  then
    raise exception 'CANNOT_DEACTIVATE_SELF';
  end if;

  if input_requesting_admin_user_id = input_target_admin_user_id
    and normalized_role = 'admin'
  then
    raise exception 'CANNOT_REMOVE_OWN_SUPER_ADMIN';
  end if;

  return query
  update public.admin_users au
  set
    role = coalesce(normalized_role, au.role),
    is_active = coalesce(input_is_active, au.is_active)
  where au.id = input_target_admin_user_id
  returning
    au.id,
    au.short_id,
    au.username,
    au.is_active,
    au.role;
end;
$$;

revoke all on function public.update_admin_user_for_super_admin(uuid, uuid, text, boolean) from public;
grant execute on function public.update_admin_user_for_super_admin(uuid, uuid, text, boolean) to anon, authenticated, service_role;
