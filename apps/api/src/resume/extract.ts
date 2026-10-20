import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export class ResumeParseError extends Error {
  constructor(readonly code: "UNSUPPORTED_FILE" | "EMPTY_DOCUMENT" | "INVALID_DOCUMENT" | "UNREADABLE_DOCUMENT", message: string) { super(message); }
}

export async function extractResumeText(filePath: string, extension: string): Promise<string> {
  const buffer = await readFile(filePath);
  try {
    let text: string;
    if (extension === ".pdf") {
      const parser = new PDFParse({ data: buffer });
      try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
    } else if (extension === ".docx") {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else throw new ResumeParseError("UNSUPPORTED_FILE", "Upload a PDF or DOCX resume.");
    text = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text || (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 10) throw new ResumeParseError("EMPTY_DOCUMENT", extension === ".pdf" ? "No selectable text was found. Scanned PDFs need OCR, which is not supported yet." : "No text was found in this document.");
    return text.slice(0, 100000);
  } catch (error) {
    if (error instanceof ResumeParseError) throw error;
    throw new ResumeParseError("INVALID_DOCUMENT", "This file could not be read. Check that it is a valid, unprotected PDF or DOCX.");
  }
}
