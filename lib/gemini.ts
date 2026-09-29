import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { assertNoPII, type PII } from "./pii";

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every AI call goes through here. `candidateText` (the candidate-derived part of
// the prompt) is checked against their stored personal details before sending.
// The rubric itself is not checked: it names past hires, who may share a first name.
export async function geminiJSON<T>(opts: {
  prompt: string;
  schema: object;
  pii: PII;
  candidateText: string;
  temperature?: number;
}): Promise<T> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  if (!opts.prompt.includes(opts.candidateText)) throw new Error("PII guard: candidateText must be part of prompt");
  assertNoPII(opts.candidateText, opts.pii);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: MODEL(),
        contents: opts.prompt,
        config: {
          temperature: opts.temperature ?? 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
        },
      });
      return JSON.parse(res.text ?? "") as T;
    } catch (e: unknown) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      const retryable = /429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|Unexpected end of JSON/i.test(msg);
      if (!retryable) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error(`Gemini call failed: ${String((lastErr as Error)?.message ?? lastErr).slice(0, 300)}`);
}
