-- Typing Trainer schema (PRD §20.1). RLS on every table, deny-by-default;
-- the service-role key is used only by server routes (§22.4).

-- Profiles ------------------------------------------------------------
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  layout_id     text not null default 'qwerty-us',
  typing_profile jsonb not null default '{"writer":1.0}'::jsonb,
  goal_wpm      int,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Sessions ------------------------------------------------------------
create table sessions (
  id             uuid primary key,                    -- client-generated
  user_id        uuid not null references profiles(id) on delete cascade,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  mode           text not null,
  planned_minutes int,
  engine_version text not null,
  score_version  int not null,
  config_hash    text not null,
  layout_id      text not null,
  wpm_net        real, wpm_raw real, accuracy real,
  consistency    real, rhythm real,
  keystrokes     int, errors int, corrections int,
  active_ms      int,
  speed_test_wpm real,
  snapshot       jsonb,
  created_at     timestamptz not null default now()
);
create index on sessions (user_id, started_at desc);

-- Blocks --------------------------------------------------------------
create table session_blocks (
  id           uuid primary key,
  session_id   uuid not null references sessions(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  ordinal      int not null,
  kind         text not null,        -- 'warmup'|'target'|'transfer'|'test'|'probe'
  stage        int not null,         -- 0..5
  targets      text[] not null,
  visibility   text not null,
  generator_seed bigint not null,
  text_hash    text not null,
  wpm_net real, accuracy real, rhythm real,
  keystrokes int, active_ms int,
  -- compressed keystroke stream: columnar arrays, gzip, base64 (§20.2)
  keystrokes_blob text,
  created_at   timestamptz not null default now()
);
create index on session_blocks (session_id, ordinal);

-- Aggregated pattern statistics (the hot table) ------------------------
create table pattern_stats (
  user_id      uuid not null references profiles(id) on delete cascade,
  pattern      text not null,
  pattern_type text not null,
  n            int not null default 0,
  ewma_log_iki real not null,
  ewma_var     real not null default 0,
  accuracy     real not null default 1,
  last_seen    timestamptz not null,
  primary key (user_id, pattern_type, pattern)
);

-- Fitted attribution model --------------------------------------------
create table model_params (
  user_id      uuid primary key references profiles(id) on delete cascade,
  fitted_at    timestamptz not null,
  n_obs        int not null,
  coefficients jsonb not null,
  std_errors   jsonb not null,
  tradeoff     jsonb not null,
  engine_version text not null
);

-- SRS -----------------------------------------------------------------
create table srs_items (
  user_id     uuid not null references profiles(id) on delete cascade,
  pattern     text not null,
  pattern_type text not null,
  stability   real not null,
  difficulty  real not null,
  reps        int not null default 0,
  lapses      int not null default 0,
  state       text not null,
  target_iki  real not null,
  last_review timestamptz,
  due_at      timestamptz not null,
  primary key (user_id, pattern_type, pattern)
);
create index on srs_items (user_id, due_at);

-- Curriculum ----------------------------------------------------------
create table curriculum_state (
  user_id       uuid primary key references profiles(id) on delete cascade,
  track         text not null,
  unit          text not null,
  unlocked_chars text not null,
  stage_by_pattern jsonb not null default '{}'::jsonb,
  completed_units text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

-- Diagnoses -----------------------------------------------------------
create table diagnoses (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  session_id  uuid references sessions(id) on delete cascade,
  kind        text not null,          -- 'session'|'plateau'|'habit'
  findings    jsonb not null,
  prescription jsonb,
  narration   text,
  narration_source text not null,     -- 'llm'|'template'
  created_at  timestamptz not null default now()
);

-- Plans ---------------------------------------------------------------
create table plans (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  source_diagnosis uuid references diagnoses(id),
  sessions_planned int not null,
  sessions_done    int not null default 0,
  spec        jsonb not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

-- Skill profile history ------------------------------------------------
create table skill_snapshots (
  user_id   uuid not null references profiles(id) on delete cascade,
  taken_at  timestamptz not null,
  speed real, accuracy real, consistency real,
  rhythm real, weak_key real, punctuation real, overall real,
  score_version int not null,
  primary key (user_id, taken_at)
);

-- Achievements ---------------------------------------------------------
create table achievements (
  user_id   uuid not null references profiles(id) on delete cascade,
  key       text not null,
  earned_at timestamptz not null default now(),
  meta      jsonb,
  primary key (user_id, key)
);

-- RLS: every table, user_id = auth.uid(), no exceptions (§20.1) --------
alter table profiles enable row level security;
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'sessions','session_blocks','pattern_stats','model_params','srs_items',
    'curriculum_state','diagnoses','plans','skill_snapshots','achievements'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (user_id = auth.uid())', t, t);
    execute format('create policy %I_insert on %I for insert with check (user_id = auth.uid())', t, t);
    execute format('create policy %I_update on %I for update using (user_id = auth.uid())', t, t);
    execute format('create policy %I_delete on %I for delete using (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- Retention (PRD §20.2): raw keystroke blobs pruned by the cron route.
create index session_blocks_created_idx on session_blocks (created_at);
