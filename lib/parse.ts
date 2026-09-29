import { extractText, getDocumentProxy } from "unpdf";

export async function fileToText(name: string, buf: ArrayBuffer): Promise<string> {
  const ext = name.toLowerCase().split(".").pop();
  let text: string;
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (ext === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value;
  } else if (ext === "txt" || ext === "md") {
    text = new TextDecoder().decode(buf);
  } else {
    throw new Error(`Unsupported file type .${ext} (use PDF, DOCX or TXT)`);
  }
  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 150) throw new Error("No readable text found (scanned image PDF?)");
  return text;
}
