# Kargo Hiring Dashboard

Internal tool for one person (Arjun). Upload CV → personal details split off → scored against both PM and SPM rubrics → top 5 per role get an interview brief + invite draft, everyone else a rejection draft → Arjun reviews and clicks Send. Nothing is sent without that click.

## Pipeline

| Step | Where | AI? |
|---|---|---|
| Parse PDF/DOCX/TXT | `lib/parse.ts` | no |
| Separate name/email/phone, redact them from CV text | `lib/pii.ts` | **no, plain code**, so PII never reaches Gemini |
| Score all 8 criteria (4 PM + 4 SPM), 0-3 + one-line reason | `lib/pipeline.ts` `scoreCandidate` | Gemini, temp 0 |
| Weighted 0-100 totals | same, in code | no |
| The line: top `TOP_N` per applied role = invite | `computeTiers` | no |
| 3-sentence brief + invite, or warm rejection | `generateDraft` | Gemini |
| `[NAME]` → real first name | `fillName`, at display/send time | no |
| Send | `app/api/send` via Resend, founder click only | no |

Every Gemini call passes through `lib/gemini.ts`, which refuses to send if the candidate's stored name, email or phone appears in the candidate text.

When a new CV moves the line, affected unsent drafts are regenerated automatically. Arjun can override any decision ("Move to invite/rejection"), edit drafts, and fix contact details.

## Setup

1. **Supabase**: create a project, open the SQL editor, and run `supabase/schema.sql` and then `supabase/seed_rubric.sql`.
2. `.env.local`: fill in from `.env.example`. Use the Supabase **service role** key; it stays server-side, and RLS blocks every other key.
3. `npm install && npm run dev`
4. **Vercel**: import the repo, add the same env vars, and deploy.

### Changing the rubric
Edit `rubric.txt`, run `npm run seed:sql`, then run the regenerated `supabase/seed_rubric.sql`. Re-score candidates afterwards.
