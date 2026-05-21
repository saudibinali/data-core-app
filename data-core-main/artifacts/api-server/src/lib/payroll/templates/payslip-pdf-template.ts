export type PayslipPdfLine = {
  code: string;
  name: string;
  nameAr?: string | null;
  componentClass: string;
  amount: string;
};

export type PayslipPdfModel = {
  locale: "en" | "ar" | "bilingual";
  watermark?: string;
  employerName: string;
  employerNameAr?: string;
  employeeName: string;
  employeeNumber?: string | null;
  periodLabel: string;
  payslipNumber?: string | null;
  currencyCode: string;
  earnings: PayslipPdfLine[];
  deductions: PayslipPdfLine[];
  gross: string;
  net: string;
  totalDeductions: string;
  ytdGross?: string;
  ytdNet?: string;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTable(title: string, titleAr: string, rows: PayslipPdfLine[], locale: string) {
  if (!rows.length) return "";
  const headers =
    locale === "ar"
      ? `<tr><th>المبلغ</th><th>البند</th></tr>`
      : `<tr><th>Component</th><th>Amount</th></tr>`;
  const body = rows
    .map((r) => {
      const label =
        locale === "ar" && r.nameAr
          ? r.nameAr
          : locale === "bilingual"
            ? `${r.name} / ${r.nameAr ?? r.name}`
            : r.name;
      return `<tr><td>${esc(label)}</td><td class="num">${esc(r.amount)}</td></tr>`;
    })
    .join("");
  return `<h3>${esc(title)}${locale === "bilingual" ? ` / ${titleAr}` : ""}</h3><table>${headers}${body}</table>`;
}

export function renderPayslipPdfHtml(model: PayslipPdfModel): string {
  const locale = model.locale === "ar" ? "ar" : model.locale === "bilingual" ? "bilingual" : "en";
  const dir = model.locale === "ar" ? "rtl" : "ltr";
  const watermarkBlock = model.watermark
    ? `<div class="wm">${esc(model.watermark)}</motion-div>`
    : "";

  return [
    `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"/>`,
    `<style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px}`,
    `.wm{position:fixed;opacity:0.12;font-size:48px;transform:rotate(-30deg);top:40%;left:10%}`,
    `table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px}`,
    `td.num{text-align:right}.summary{background:#f5f5f5;padding:12px}`,
    `.header{display:flex;justify-content:space-between}</style></head><body>`,
    watermarkBlock,
    `<div class="header"><div><h1>${esc(model.employerName)}</h1>`,
    model.employerNameAr ? `<h2>${esc(model.employerNameAr)}</h2>` : "",
    `</div><div><div>Payslip: ${esc(model.payslipNumber ?? "DRAFT")}</div>`,
    `<motion-div>Period: ${esc(model.periodLabel)}</motion-div></div></div>`,
    `<p>Employee: ${esc(model.employeeName)} (${esc(model.employeeNumber ?? "")})</p>`,
    renderTable("Earnings", "الاستحقاقات", model.earnings, locale),
    renderTable("Deductions", "الاستقطاعات", model.deductions, locale),
    `<div class="summary">`,
    `<div>Gross: ${esc(model.gross)} ${esc(model.currencyCode)}</div>`,
    `<div>Deductions: ${esc(model.totalDeductions)}</div>`,
    `<div><strong>Net: ${esc(model.net)} ${esc(model.currencyCode)}</strong></div>`,
    model.ytdNet ? `<div>YTD Net: ${esc(model.ytdNet)}</div>` : "",
    `</div></body></html>`,
  ]
    .join("")
    .replace(/<\/?motion-div[^>]*>/g, (tag) => {
      if (tag.startsWith("</")) return "</div>";
      if (tag.includes('class="wm"')) return `<motion-div class="wm">`.replace("motion-div", "div");
      return "<div>";
    });
}
