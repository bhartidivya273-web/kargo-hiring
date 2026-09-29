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
-- Generated from rubric.txt by scripts/rubric-to-sql.mjs. Do not edit by hand.
begin;
insert into rubric_guide (id, text) values (1, $q$KARGO HIRING RUBRIC
Derived from patterns in the 8 past-hire profiles (not from the job descriptions).

SCORING (all criteria)
0 = nothing on the CV
1 = vague or claimed line, no example
2 = one specific example
3 = two or more specific examples

Rules:
- Score only what is written. Self-descriptions ("comfortable owning processes", "proactive") and other people's opinions score 0 unless backed by an example.
- Certifications, colleges and conference talks earn nothing.
- Treat scores as a ranking aid for the founder, not a prediction. Built on 8 profiles.$q$)
  on conflict (id) do update set text = excluded.text;
insert into roles (code, title, bar_note) values ('PM', $q$Product Manager$q$, $q$$q$)
  on conflict (code) do update set title = excluded.title, bar_note = excluded.bar_note;
insert into rubric_criteria (role, position, name, description, weight) values ('PM', 1, $q$Fix that others adopted$q$, $q$They saw a broken or missing process that wasn't part of their job and built something to fix it. The CV says what they built and how many people outside their own reporting line ended up using it.
  Strong: "Built shipment tracker in Excel; adopted by the 12-person ops team in two weeks" (Rohan). "Onboarding framework the full CS team now uses" (Meghna).
  Weak: "Improved the onboarding flow" with no number and no other users. "Built a dashboard" only the author used (Preetham). "Introduced a template" only their own function adopted. Any fix that was assigned as part of their role.$q$, 35)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('PM', 2, $q$Written failure trail$q$, $q$The CV names one specific thing that went wrong (lost deal, outage, bug, error), says they wrote it up (post-mortem, root-cause note, bug report), and that something changed afterwards.
  Strong: "Ran a post-mortem on the lost deal, documented root cause, now standard before account qualification" (Aditya). "Wrote the internal and customer-facing post-mortems" (Lavanya).
  Weak: a CV with only successes (Vikram, Rahul). "Learned from setbacks" with no incident named. A failure mentioned with no written record or change.
  Do not score features being cancelled (appears in the PM job description).$q$, 25)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('PM', 3, $q$Acted before it was reported$q$, $q$The CV shows them finding a problem before a customer, manager or regulator raised it, with a stated lead time or outcome.
  Strong: "Found and fixed four documentation gaps before the inspection" (Sunita). "Flagged at-risk accounts 30-45 days before renewal" (Meghna). "Resolved the customs hold before the client became aware" (Meghna).
  Weak: "Resolved P1 incidents in 22 minutes" (Preetham) - fast, but a response to something already reported. "Proactive" or "self-starter" with no example.$q$, 25)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('PM', 4, $q$Owned it start to finish$q$, $q$They took a problem involving other people or companies through every step and stayed on it for weeks. The CV lists the steps they personally did (scoped, coordinated, trained, tracked the aftermath).
  Strong: scoped a system migration, managed the vendor, trained staff, monitored the first 30 days (Sunita). 6-week bug resolution including engineering coordination and customer updates (Meghna).
  Weak: "Supported", "assisted", "part of the team that". A single fast fix inside their own code or area. A high-sounding title alone earns nothing.$q$, 15)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
delete from rubric_criteria where role = 'PM' and position > 4;
insert into roles (code, title, bar_note) values ('SPM', $q$Senior Product Manager$q$, $q$Same criteria; higher bar. Examples must cross teams or companies, repeat, and show nobody above made the call.$q$)
  on conflict (code) do update set title = excluded.title, bar_note = excluded.bar_note;
insert into rubric_criteria (role, position, name, description, weight) values ('SPM', 1, $q$Fix that others adopted$q$, $q$Everything in the PM version, plus at least one fix that spread to other teams or a customer's own staff and stayed in use after the person moved on.
  Strong: "Dashboard adopted by 2 other regional teams" (Lavanya). "Procedures adopted in full within 60 days" by a client firm (Sunita).
  Weak: adoption only by direct reports. One fix, nothing repeated. Anything that lapsed once they left.
  Score 3 only if it happened more than once.$q$, 25)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('SPM', 2, $q$Written failure trail$q$, $q$Everything in the PM version, plus a version written for people outside their team (customers or leadership) and follow-up actions they personally tracked to completion.
  Strong: "Owned the follow-up action items to closure" (Lavanya).
  Weak: a post-mortem written by someone else. A team retrospective with no named author.$q$, 20)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('SPM', 3, $q$Acted before it was reported$q$, $q$At least two separate examples, at least one affecting customers or another company. Each states when the problem was caught relative to when it would have surfaced.
  Strong: two or more early catches across different clients or systems.
  Weak: one early catch. "Anticipated customer needs" with no example.$q$, 25)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
insert into rubric_criteria (role, position, name, description, weight) values ('SPM', 4, $q$Owned it start to finish$q$, $q$At least two multi-week problems carried alone, where the CV shows no senior person approving the decisions. Each states a result (on time, no penalty, no data loss).
  Strong: "Led migration off the vendor under time pressure, no data loss, 60% less lag" (Rohan). Scoping, training and 30-day monitoring of a client migration (Sunita).
  Weak: work done "with" or "under" a senior person. One example only. Ownership claimed in the summary line but not backed by an item in the work history.$q$, 25)
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
delete from rubric_criteria where role = 'SPM' and position > 4;
commit;
