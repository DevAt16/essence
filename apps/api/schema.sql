create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  username text null,
  first_name text null,
  last_name text null,
  is_local boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists username text null;
alter table users add column if not exists first_name text null;
alter table users add column if not exists last_name text null;

insert into users (id, email, display_name, is_local)
values ('local', 'local@essence.local', 'Local Workspace', true)
on conflict (id) do nothing;

create table if not exists user_sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists user_sessions_user_id_idx on user_sessions(user_id);
create index if not exists user_sessions_expires_at_idx on user_sessions(expires_at);

create table if not exists approved_users (
  email text primary key,
  display_name text null,
  notes text not null default '',
  approved_by text null,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approved_users_revoked_at_idx on approved_users(revoked_at);

create table if not exists user_identities (
  provider text not null,
  subject text not null,
  user_id text not null references users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index if not exists user_identities_user_id_idx on user_identities(user_id);

create table if not exists app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists workspace_state (
  id text primary key,
  active_note_id text null,
  composer_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table workspace_state add column if not exists composer_history jsonb not null default '[]'::jsonb;

create table if not exists composer_settings (
  user_id text primary key references users(id) on delete cascade,
  provider text null,
  model text not null default '',
  ollama_base_url text not null default '',
  api_key_ciphertext text null,
  api_key_provider text null,
  api_key_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table composer_settings add column if not exists model text not null default '';
alter table composer_settings add column if not exists ollama_base_url text not null default '';
alter table composer_settings add column if not exists api_key_ciphertext text null;
alter table composer_settings add column if not exists api_key_provider text null;
alter table composer_settings add column if not exists api_key_updated_at timestamptz null;

create table if not exists collections (
  id text not null,
  user_id text not null default 'local' references users(id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default 'folder',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists collections_user_id_idx on collections(user_id);

create table if not exists folders (
  id text primary key,
  user_id text not null default 'local' references users(id) on delete cascade,
  name text not null,
  parent_id text null references folders(id) on delete set null,
  collection_id text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table folders add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists folders_parent_id_idx on folders(parent_id);
create index if not exists folders_collection_id_idx on folders(collection_id);
create index if not exists folders_user_id_idx on folders(user_id);

create table if not exists notes (
  id text primary key,
  user_id text not null default 'local' references users(id) on delete cascade,
  title text not null,
  collection_id text not null,
  folder_id text null references folders(id) on delete set null,
  status text not null,
  preview_date text not null,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  type text null,
  layout text not null,
  editor_doc jsonb null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table notes add column if not exists user_id text not null default 'local' references users(id) on delete cascade;
alter table notes add column if not exists is_pinned boolean not null default false;
alter table notes add column if not exists editor_doc jsonb null;

create index if not exists notes_folder_id_idx on notes(folder_id);
create index if not exists notes_collection_id_idx on notes(collection_id);
create index if not exists notes_is_pinned_idx on notes(is_pinned);
create index if not exists notes_sort_order_idx on notes(sort_order);
create index if not exists notes_user_id_idx on notes(user_id);

create table if not exists note_blocks (
  id text primary key,
  note_id text not null references notes(id) on delete cascade,
  position integer not null,
  type text not null,
  text_content text null,
  items jsonb null,
  citation text null
);

alter table note_blocks add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists note_blocks_note_id_idx on note_blocks(note_id);

create table if not exists note_sources (
  id text primary key,
  note_id text not null references notes(id) on delete cascade,
  position integer not null,
  source_type text not null default 'other',
  title text not null default '',
  author text not null default '',
  year text not null default '',
  publisher text not null default '',
  url text not null default '',
  note text not null default ''
);

alter table note_sources add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists note_sources_note_id_idx on note_sources(note_id);
create index if not exists note_sources_source_type_idx on note_sources(source_type);

create table if not exists note_tags (
  note_id text not null references notes(id) on delete cascade,
  tag text not null,
  position integer not null default 0,
  primary key (note_id, tag)
);

alter table note_tags add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists note_tags_tag_idx on note_tags(tag);
create index if not exists note_tags_note_id_position_idx on note_tags(note_id, position);

create table if not exists note_links (
  id bigserial primary key,
  source_note_id text not null references notes(id) on delete cascade,
  target_note_id text not null references notes(id) on delete cascade,
  source_block_id text null,
  link_text text not null,
  occurrence_count integer not null default 1
);

alter table note_links add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists note_links_source_note_id_idx on note_links(source_note_id);
create index if not exists note_links_target_note_id_idx on note_links(target_note_id);

with note_user_candidates as (
  select id, min(user_id) as user_id, count(*) as user_count
  from notes
  group by id
)
update note_blocks
set user_id = note_user_candidates.user_id
from note_user_candidates
where note_blocks.note_id = note_user_candidates.id
  and note_user_candidates.user_count = 1
  and not exists (
    select 1
    from notes
    where notes.user_id = note_blocks.user_id and notes.id = note_blocks.note_id
  );

with note_user_candidates as (
  select id, min(user_id) as user_id, count(*) as user_count
  from notes
  group by id
)
update note_sources
set user_id = note_user_candidates.user_id
from note_user_candidates
where note_sources.note_id = note_user_candidates.id
  and note_user_candidates.user_count = 1
  and not exists (
    select 1
    from notes
    where notes.user_id = note_sources.user_id and notes.id = note_sources.note_id
  );

with note_user_candidates as (
  select id, min(user_id) as user_id, count(*) as user_count
  from notes
  group by id
)
update note_tags
set user_id = note_user_candidates.user_id
from note_user_candidates
where note_tags.note_id = note_user_candidates.id
  and note_user_candidates.user_count = 1
  and not exists (
    select 1
    from notes
    where notes.user_id = note_tags.user_id and notes.id = note_tags.note_id
  );

with note_user_candidates as (
  select id, min(user_id) as user_id, count(*) as user_count
  from notes
  group by id
)
update note_links
set user_id = note_user_candidates.user_id
from note_user_candidates
where note_links.source_note_id = note_user_candidates.id
  and note_user_candidates.user_count = 1
  and not exists (
    select 1
    from notes
    where notes.user_id = note_links.user_id and notes.id = note_links.source_note_id
  );

alter table note_links drop constraint if exists note_links_source_note_id_fkey;
alter table note_links drop constraint if exists note_links_target_note_id_fkey;
alter table note_links drop constraint if exists note_links_user_source_note_id_fkey;
alter table note_links drop constraint if exists note_links_user_target_note_id_fkey;
alter table note_tags drop constraint if exists note_tags_note_id_fkey;
alter table note_tags drop constraint if exists note_tags_user_note_id_fkey;
alter table note_sources drop constraint if exists note_sources_note_id_fkey;
alter table note_sources drop constraint if exists note_sources_user_note_id_fkey;
alter table note_blocks drop constraint if exists note_blocks_note_id_fkey;
alter table note_blocks drop constraint if exists note_blocks_user_note_id_fkey;
alter table notes drop constraint if exists notes_folder_id_fkey;
alter table folders drop constraint if exists folders_parent_id_fkey;

alter table note_tags drop constraint if exists note_tags_pkey;
alter table note_sources drop constraint if exists note_sources_pkey;
alter table note_blocks drop constraint if exists note_blocks_pkey;
alter table notes drop constraint if exists notes_pkey;
alter table folders drop constraint if exists folders_pkey;

alter table folders add constraint folders_pkey primary key (user_id, id);
alter table notes add constraint notes_pkey primary key (user_id, id);
alter table note_blocks add constraint note_blocks_pkey primary key (user_id, id);
alter table note_sources add constraint note_sources_pkey primary key (user_id, id);
alter table note_tags add constraint note_tags_pkey primary key (user_id, note_id, tag);

drop index if exists note_blocks_note_id_position_idx;
drop index if exists note_sources_note_id_position_idx;

create index if not exists folders_user_parent_id_idx on folders(user_id, parent_id);
create index if not exists folders_user_collection_id_idx on folders(user_id, collection_id);
create index if not exists notes_user_folder_id_idx on notes(user_id, folder_id);
create index if not exists notes_user_collection_id_idx on notes(user_id, collection_id);
create index if not exists note_blocks_user_note_id_idx on note_blocks(user_id, note_id);
create unique index if not exists note_blocks_user_note_position_idx on note_blocks(user_id, note_id, position);
create index if not exists note_sources_user_note_id_idx on note_sources(user_id, note_id);
create unique index if not exists note_sources_user_note_position_idx on note_sources(user_id, note_id, position);
create index if not exists note_tags_user_note_position_idx on note_tags(user_id, note_id, position);
create index if not exists note_links_user_source_note_id_idx on note_links(user_id, source_note_id);
create index if not exists note_links_user_target_note_id_idx on note_links(user_id, target_note_id);

alter table note_blocks
  add constraint note_blocks_user_note_id_fkey
  foreign key (user_id, note_id) references notes(user_id, id) on delete cascade;

alter table note_sources
  add constraint note_sources_user_note_id_fkey
  foreign key (user_id, note_id) references notes(user_id, id) on delete cascade;

alter table note_tags
  add constraint note_tags_user_note_id_fkey
  foreign key (user_id, note_id) references notes(user_id, id) on delete cascade;

alter table note_links
  add constraint note_links_user_source_note_id_fkey
  foreign key (user_id, source_note_id) references notes(user_id, id) on delete cascade;

alter table note_links
  add constraint note_links_user_target_note_id_fkey
  foreign key (user_id, target_note_id) references notes(user_id, id) on delete cascade;

create table if not exists note_revisions (
  id bigserial primary key,
  user_id text not null default 'local' references users(id) on delete cascade,
  note_id text not null,
  note_title text not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  revision_kind text not null default 'snapshot',
  created_at timestamptz not null default now()
);

alter table note_revisions add column if not exists user_id text not null default 'local' references users(id) on delete cascade;

create index if not exists note_revisions_note_id_created_at_idx on note_revisions(note_id, created_at desc);
create index if not exists note_revisions_user_note_id_created_at_idx on note_revisions(user_id, note_id, created_at desc);
