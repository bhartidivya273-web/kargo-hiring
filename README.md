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

## Operating notes

- **Test mode:** while `EMAIL_TEST_OVERRIDE` is set, every email goes to that address instead of the candidate's. Resend without a verified domain can only deliver to the account owner anyway. To email real candidates: verify a domain in Resend, set `RESEND_FROM` to an address on it, and delete `EMAIL_TEST_OVERRIDE`.
- **Gemini key:** if uploads fail with `Gemini call failed ... 401`, the key has expired or been revoked. Create a new one at aistudio.google.com/apikey, update `GEMINI_API_KEY` in Vercel (and `.env.local`), and redeploy. Enable billing on the key's project so inputs are not used for training.
- **Rubric weights:** the SPM weights in `rubric.txt` total 100. If the database predates that fix, run `update rubric_criteria set weight = 25 where role = 'SPM' and name = 'Written failure trail';` or re-run `supabase/seed_rubric.sql`.
- **Verified end to end (live):** 15 synthetic CVs uploaded, scored on both rubrics, top 5 per role given a 3-sentence brief and invite draft, the rest a rejection draft, no personal details in stored CV text, one email delivered via Resend with the real first name, a second send refused.
