-- Kargo hiring dashboard schema. Run once, then run seed_rubric.sql.
-- All access goes through the server with the service role key. RLS is on with
-- no policies, so the public anon key can read nothing (candidate PII included).

create table if not exists roles (
  code text primary key check (code in ('PM', 'SPM')),
  title text not null,
  bar_note text not null default '',
  jd_text text                      -- reference only; never used for scoring
);

create table if not exists rubric_guide (
  id int primary key default 1 check (id = 1),
  text text not null                -- scoring scale + rules shared by both roles
);

create table if not exists rubric_criteria (
  id bigint generated always as identity primary key,
  role text not null references roles(code),
  position int not null,
  name text not null,
  description text not null,
  weight int not null check (weight between 0 and 100),
  unique (role, position)
);

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  applied_role text not null references roles(code),
  file_name text not null,
  content_hash text not null unique,        -- stops the same CV being scored twice
  cv_text text not null,                    -- REDACTED: no name, email or phone
  status text not null default 'pending' check (status in ('pending', 'scored', 'error')),
  error text,
  pm_score numeric(5,1),                    -- 0-100, weighted in code, not by the AI
  spm_score numeric(5,1),
  override_tier text check (override_tier in ('invite', 'reject')),
  brief text,
  email_subject text,
  email_body text,                          -- contains the [NAME] placeholder
  draft_tier text check (draft_tier in ('invite', 'reject')),
  draft_edited boolean not null default false,
  send_status text check (send_status in ('sending', 'sent')),
  sent_at timestamptz,
  sent_tier text,
  sent_to text,
  resend_id text,
  created_at timestamptz not null default now()
);

-- Personal details live apart from CV content and are never sent to the AI.
create table if not exists candidate_pii (
  candidate_id uuid primary key references candidates(id) on delete cascade,
  name text,
  email text,
  phone text
);

create table if not exists scores (
  candidate_id uuid not null references candidates(id) on delete cascade,
  criterion_id bigint not null references rubric_criteria(id) on delete cascade,
  role text not null,
  score int not null check (score between 0 and 3),
  reason text not null,
  primary key (candidate_id, criterion_id)
);

create index if not exists candidates_role_pm on candidates (applied_role, pm_score desc);
create index if not exists candidates_role_spm on candidates (applied_role, spm_score desc);

alter table roles enable row level security;
alter table rubric_guide enable row level security;
alter table rubric_criteria enable row level security;
alter table candidates enable row level security;
alter table candidate_pii enable row level security;
alter table scores enable row level security;
