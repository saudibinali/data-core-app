import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { logger } from "../logger";
/** HTML → PDF (puppeteer optional, else table extraction or fallback). */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  if (process.env.PDF_RENDERER === "puppeteer") {
    try {
      const puppeteer = await import("puppeteer");
      const browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      await browser.close();
      return Buffer.from(pdf);
    } catch (err) {
      logger.warn({ err }, "[pdf] puppeteer failed, falling back to builtin");
    }
  }

  return renderBuiltinPdfFromHtml(html);
}

export async function renderTablePdfToBuffer(
  title: string,
  subtitle: string,
  headers: string[],
  rows: string[][],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, x: number, size: number, bold = false) => {
    page.drawText(text.slice(0, 100), {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  drawText(title, margin, 16, true);
  y -= 22;
  if (subtitle) {
    drawText(subtitle, margin, 10);
    y -= 16;
  }

  const colCount = Math.max(headers.length, 1);
  const colWidth = (pageWidth - margin * 2) / colCount;

  const drawRow = (cells: string[], header = false) => {
    if (y < margin + 30) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    cells.forEach((cell, i) => {
      drawText(cell, margin + i * colWidth, header ? 9 : 8, header);
    });
    y -= header ? 14 : 12;
  };

  if (headers.length) drawRow(headers, true);
  for (const row of rows) drawRow(row);

  return Buffer.from(await doc.save());
}

/** Parse simple report HTML produced by renderReportPdfHtml */
export async function renderBuiltinPdfFromHtml(html: string): Promise<Buffer> {
  const title = extractBetween(html, 'class="title">', "</div>") ?? "Report";
  const workspace = extractBetween(html, 'class="sub">', "</div>") ?? "";
  const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1] ?? "");
  const rowMatches = [...html.matchAll(/<tr>([^<]*(?:<td>[^<]*<\/td>)+[^<]*)<\/tr>/g)];
  const rows: string[][] = [];
  for (const rm of rowMatches) {
    const cells = [...(rm[0] ?? "").matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1] ?? "");
    if (cells.length > 0) rows.push(cells);
  }
  // Skip header row duplicate if first row equals headers
  const dataRows = rows.filter((r) => r.join("|") !== headers.join("|"));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, x: number, size: number, bold = false) => {
    page.drawText(text.slice(0, 120), {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  drawText(title, margin, 16, true);
  y -= 22;
  if (workspace) {
    drawText(workspace, margin, 10);
    y -= 16;
  }

  const colCount = Math.max(headers.length, 1);
  const colWidth = (pageWidth - margin * 2) / colCount;

  const drawRow = (cells: string[], header = false) => {
    if (y < margin + 30) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    cells.forEach((cell, i) => {
      drawText(cell, margin + i * colWidth, header ? 9 : 8, header);
    });
    y -= header ? 14 : 12;
  };

  if (headers.length) drawRow(headers, true);
  for (const row of dataRows) {
    drawRow(row);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function extractBetween(haystack: string, start: string, end: string): string | null {
  const i = haystack.indexOf(start);
  if (i < 0) return null;
  const j = haystack.indexOf(end, i + start.length);
  if (j < 0) return null;
  return haystack.slice(i + start.length, j).trim();
}
