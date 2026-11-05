import { describe, expect, it } from 'vitest';
import { loadDocument } from '../src/ingest/loaders.ts';

const md = (s: string) => Buffer.from(s, 'utf8');

describe('loadDocument (Markdown)', () => {
  it('uses the first H1 as title and the heading path below it as location', async () => {
    const doc = await loadDocument(
      'pricing.md',
      md(`# Plans and Pricing

Intro text.

## Plans

Table here.

### What each plan includes

Details.

## Annual billing

20% off.
`),
    );

    expect(doc.title).toBe('Plans and Pricing');
    expect(doc.sections).toEqual([
      { location: 'Overview', text: 'Intro text.' },
      { location: 'Plans', text: 'Table here.' },
      { location: 'Plans › What each plan includes', text: 'Details.' },
      { location: 'Annual billing', text: '20% off.' },
    ]);
  });

  it('ignores "#" lines inside code fences', async () => {
    const doc = await loadDocument('api.md', md('# API\n\n## Usage\n\n```bash\n# not a heading\ncurl x\n```\n'));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].location).toBe('Usage');
    expect(doc.sections[0].text).toContain('# not a heading');
  });

  it('falls back to the file name when there is no H1, and skips empty sections', async () => {
    const doc = await loadDocument('faq.md', md('## Empty\n\n## Real\n\nAnswer.'));
    expect(doc.title).toBe('faq');
    expect(doc.sections).toEqual([{ location: 'Real', text: 'Answer.' }]);
  });

  it('rejects unsupported file types', async () => {
    await expect(loadDocument('sheet.xlsx', md(''))).rejects.toThrow('Unsupported file type');
  });
});

describe('loadDocument (PDF)', () => {
  it('creates one section per page so answers can cite page numbers', async () => {
    const doc = await loadDocument('terms.pdf', buildPdf(['Refunds within thirty days', 'Governing law is Croatia']));
    expect(doc.title).toBe('terms');
    expect(doc.sections.map((s) => s.location)).toEqual(['Page 1', 'Page 2']);
    expect(doc.sections[0].text).toContain('Refunds within thirty days');
    expect(doc.sections[1].text).toContain('Governing law is Croatia');
  });
});

/** Minimal valid PDF with one line of Helvetica text per page. */
function buildPdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
