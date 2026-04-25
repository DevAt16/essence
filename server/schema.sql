create table if not exists app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists workspace_state (
  id text primary key,
  active_note_id text null,
  updated_at timestamptz not null default now()
);

create table if not exists folders (
  id text primary key,
  name text not null,
  parent_id text null references folders(id) on delete set null,
  collection_id text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists folders_parent_id_idx on folders(parent_id);
create index if not exists folders_collection_id_idx on folders(collection_id);

create table if not exists notes (
  id text primary key,
  title text not null,
  collection_id text not null,
  folder_id text null references folders(id) on delete set null,
  status text not null,
  preview_date text not null,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  type text null,
  layout text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table notes add column if not exists is_pinned boolean not null default false;

create index if not exists notes_folder_id_idx on notes(folder_id);
create index if not exists notes_collection_id_idx on notes(collection_id);
create index if not exists notes_is_pinned_idx on notes(is_pinned);
create index if not exists notes_sort_order_idx on notes(sort_order);

create table if not exists note_blocks (
  id text primary key,
  note_id text not null references notes(id) on delete cascade,
  position integer not null,
  type text not null,
  text_content text null,
  items jsonb null,
  citation text null
);

create index if not exists note_blocks_note_id_idx on note_blocks(note_id);
create unique index if not exists note_blocks_note_id_position_idx on note_blocks(note_id, position);

create table if not exists note_tags (
  note_id text not null references notes(id) on delete cascade,
  tag text not null,
  position integer not null default 0,
  primary key (note_id, tag)
);

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

create index if not exists note_links_source_note_id_idx on note_links(source_note_id);
create index if not exists note_links_target_note_id_idx on note_links(target_note_id);

create table if not exists note_revisions (
  id bigserial primary key,
  note_id text not null,
  note_title text not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  revision_kind text not null default 'snapshot',
  created_at timestamptz not null default now()
);

create index if not exists note_revisions_note_id_created_at_idx on note_revisions(note_id, created_at desc);
