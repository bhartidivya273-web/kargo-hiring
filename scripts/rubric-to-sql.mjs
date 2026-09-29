// Parses rubric.txt and writes supabase/seed_rubric.sql.
// Re-run after editing rubric.txt, then apply the SQL in Supabase.
import { readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync(new URL("../rubric.txt", import.meta.url), "utf8").replace(/\r/g, "");
const SEP = /^=+$/m;
const parts = raw.split(SEP).map((s) => s.trim());
// parts: [guide, "PRODUCT MANAGER (PM)", pmBody, "SENIOR PRODUCT MANAGER (SPM)", spmBody]
const guide = parts[0];
const sections = [];
for (let i = 1; i < parts.length; i += 2) {
  const m = parts[i].match(/\((PM|SPM)\)/);
  if (!m) throw new Error(`Unrecognised section header: ${parts[i]}`);
  sections.push({ role: m[1], title: parts[i].replace(/\s*\(.*\)/, "").trim(), body: parts[i + 1] });
}

function parseSection({ role, title, body }) {
  const chunks = body.split(/^Criterion name:\s*/m);
  const barNote = chunks.shift().trim();
  const criteria = chunks.map((chunk, idx) => {
    const lines = chunk.split("\n");
    const name = lines.shift().trim();
    const text = lines.join("\n");
    const w = text.match(/^Weight:\s*(\d+)%/m);
    if (!w) throw new Error(`No weight for ${role}/${name}`);
    const description = text
      .slice(0, w.index)
      .replace(/^What a strong candidate looks like:\s*/m, "")
      .trim();
    return { role, position: idx + 1, name, description, weight: Number(w[1]) };
  });
  const total = criteria.reduce((a, c) => a + c.weight, 0);
  // Stored as written. Scoring divides by the real total, so scores stay 0-100.
  if (total !== 100) console.warn(`WARNING: ${role} weights sum to ${total}%, not 100%. Fix rubric.txt and re-run.`);
  if (criteria.length < 4 || criteria.length > 6) throw new Error(`${role} has ${criteria.length} criteria`);
  return { role, title, barNote: barNote.replace(/TOTAL:.*$/m, "").trim(), criteria };
}

const roles = sections.map(parseSection);
const q = (s) => `$q$${s}$q$`;

let sql = `-- Generated from rubric.txt by scripts/rubric-to-sql.mjs. Do not edit by hand.
begin;
insert into rubric_guide (id, text) values (1, ${q(guide)})
  on conflict (id) do update set text = excluded.text;
`;
for (const r of roles) {
  sql += `insert into roles (code, title, bar_note) values ('${r.role}', ${q(r.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()))}, ${q(r.barNote)})
  on conflict (code) do update set title = excluded.title, bar_note = excluded.bar_note;
`;
  for (const c of r.criteria) {
    sql += `insert into rubric_criteria (role, position, name, description, weight) values ('${c.role}', ${c.position}, ${q(c.name)}, ${q(c.description)}, ${c.weight})
  on conflict (role, position) do update set name = excluded.name, description = excluded.description, weight = excluded.weight;
`;
  }
  sql += `delete from rubric_criteria where role = '${r.role}' and position > ${r.criteria.length};
`;
}
sql += "commit;\n";

writeFileSync(new URL("../supabase/seed_rubric.sql", import.meta.url), sql);
for (const r of roles) {
  console.log(`${r.role}: ${r.criteria.map((c) => `${c.name} (${c.weight}%)`).join(", ")}`);
}
