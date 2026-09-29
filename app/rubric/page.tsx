import { ROLES } from "@/lib/db";
import { loadRubric } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export default async function RubricPage() {
  let rubric;
  try {
    rubric = await loadRubric();
  } catch (e) {
    return <p className="err">{(e as Error).message}</p>;
  }
  return (
    <>
      <h1>Rubric (loaded from the database)</h1>
      <pre className="banner small" style={{ whiteSpace: "pre-wrap" }}>{rubric.guide}</pre>
      {ROLES.map((role) => {
        const r = rubric.roles.find((x) => x.code === role);
        const crit = rubric.criteria.filter((c) => c.role === role);
        const total = crit.reduce((a, c) => a + c.weight, 0);
        return (
          <section key={role}>
            <h2>
              {r?.title} ({role}) · weights total {total}%
              {total !== 100 && <span className="err"> (not 100%: scores are normalised to 0-100 by the real total; fix rubric.txt)</span>}
            </h2>
            {r?.bar_note && <p className="muted">{r.bar_note}</p>}
            <table>
              <thead><tr><th>Criterion</th><th>What a strong candidate looks like</th><th className="num">Weight</th></tr></thead>
              <tbody>
                {crit.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{c.description}</td>
                    <td className="num">{c.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
