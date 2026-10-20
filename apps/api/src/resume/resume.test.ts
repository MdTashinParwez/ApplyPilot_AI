import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { test } from "node:test";
import { extractResumeText, ResumeParseError } from "./extract.js";
import { parseResume } from "./parse.js";

function syntheticPdf(text: string) {
  const stream = text.trim() ? `BT /F1 12 Tf 40 750 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET` : "";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("extracts text from synthetic PDF and DOCX fixtures and parses only identifiable fields", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "applypilot-test-"));
  try {
    const pdf = path.join(dir, "sample.pdf"); await writeFile(pdf, syntheticPdf("Taylor Example\nSkills\nTypeScript React\nEducation\nSample University"));
    const pdfText = await extractResumeText(pdf, ".pdf"); assert.match(pdfText, /Taylor Example/);
    const zip = new JSZip(); zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Taylor Example</w:t></w:r></w:p><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>TypeScript React</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    const docx = path.join(dir, "sample.docx"); await writeFile(docx, await zip.generateAsync({ type: "nodebuffer" }));
    const parsed = parseResume(await extractResumeText(docx, ".docx"));
    assert.equal(parsed.profile.fullName, "Taylor Example"); assert.deepEqual(parsed.profile.skills, ["TypeScript", "React"]); assert.ok(parsed.uncertain.includes("work experience"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("malformed and empty scanned-like PDFs return clear extraction errors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "applypilot-test-"));
  try {
    const bad = path.join(dir, "bad.pdf"); await writeFile(bad, "%PDF-1.4 broken");
    await assert.rejects(extractResumeText(bad, ".pdf"), (error: unknown) => error instanceof ResumeParseError);
    const empty = path.join(dir, "empty.pdf"); await writeFile(empty, syntheticPdf(" "));
    await assert.rejects(extractResumeText(empty, ".pdf"), (error: unknown) => error instanceof ResumeParseError && /OCR/.test(error.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
