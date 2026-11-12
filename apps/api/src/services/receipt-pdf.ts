/**
 * DEC-103: el PDF del comprobante de pago.
 *
 * POR QUE A MANO Y NO CON UNA LIBRERIA
 * ------------------------------------
 * Es una sola pagina de texto -a veces varias, si el pedido trae muchos
 * numeros-. Las 14 fuentes estandar de PDF (Helvetica, Courier) no se incrustan
 * y todos los lectores las tienen, asi que basta con escribir el formato: unas
 * decenas de objetos y una tabla de referencias. Una dependencia para esto
 * anadiria superficie (y avisos de `osv-scanner`) sin aportar nada.
 *
 * El texto va en WinAnsiEncoding: cubre el espanol y el ingles. Un caracter
 * fuera de esa tabla -un emoji en un nombre- se sustituye por `?` en vez de
 * romper el archivo.
 *
 * Todo el texto del documento esta en INGLES, por decision del cliente.
 */

import type { OrderReceipt } from "./order-receipt.js";

export interface ReceiptPdfInput {
  readonly receipt: OrderReceipt;
  /** Enlace al verificador de participaciones (`/en/account/entries`). */
  readonly verifierUrl: string;
  /** `https://lonestarwinners.com`. */
  readonly websiteUrl: string;
  readonly contactEmail: string;
  /** Zona con la que se escribe la fecha de pago. */
  readonly timeZone: string;
}

// ---------------------------------------------------------------------------
// Texto en WinAnsi
// ---------------------------------------------------------------------------

/** Unicode fuera de Latin-1 que SI tiene sitio en WinAnsi (0x80-0x9F). */
const WIN_ANSI_EXTRA: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // €
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
]);

/** Cada caracter a UN byte WinAnsi, como cadena `latin1`. */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0x3f;
    const extra = WIN_ANSI_EXTRA.get(code);
    if (extra !== undefined) {
      out += String.fromCharCode(extra);
    } else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += char;
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}

/** Literal de cadena PDF: escapa `\`, `(` y `)`. */
function pdfString(text: string): string {
  return `(${toWinAnsi(text).replace(/[\\()]/gu, (match) => `\\${match}`)})`;
}

// Anchos de Helvetica (AFM de Adobe), en milesimas de punto, de 0x20 a 0x7E.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * Ancho aproximado de un texto en Helvetica. Para la negrita se infla un 8 %:
 * solo sirve para partir lineas, y pasarse por poco es lo seguro.
 */
function textWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    units += code >= 0x20 && code <= 0x7e ? (HELVETICA_WIDTHS[code - 0x20] ?? 556) : 556;
  }
  return ((units * size) / 1000) * (bold ? 1.08 : 1);
}

/** Parte un texto en lineas que caben en `maxWidth`. Corta palabras larguisimas. */
function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (textWidth(candidate, size, bold) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    let rest = word;
    while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

// ---------------------------------------------------------------------------
// Formato de los datos
// ---------------------------------------------------------------------------

/** `"123456"` -> `"$1,234.56"`. Desde la cadena de digitos, sin pasar por float. */
export function formatUsd(amountMinor: string): string {
  const value = BigInt(amountMinor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toLocaleString("en-US");
  const cents = (absolute % 100n).toString(10).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${cents}`;
}

function formatPaidAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const STATUS_LABEL: Readonly<Record<OrderReceipt["payment_status"], string>> = {
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  CHARGEBACK: "Disputed (chargeback)",
  VOIDED: "Voided",
};

/** Lo que se escribe en "Number of Entries". */
export function entriesLabel(receipt: OrderReceipt): string {
  const order = receipt.order;
  switch (order.entry_state) {
    case "GRANTED":
    case "PARTIALLY_REVERSED":
    case "REVERSED":
      return (order.entries_granted ?? 0).toLocaleString("en-US");
    case "PENDING_QUALIFICATION":
      return "Pending";
    case "NOT_APPLICABLE":
      return "None for this order";
  }
}

// ---------------------------------------------------------------------------
// Maquetacion
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612; // Carta
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TOP = 78;
const BRAND_RED = "0.882 0 0.071"; // #e10012
const INK = "0.1 0.1 0.12";
const MUTED = "0.38 0.38 0.42";
const LABEL_WIDTH = 150;

const FOOTER_TEXT =
  "This receipt confirms your purchase. Sweepstakes entries are subject to the applicable Official Rules.";

type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier

class Layout {
  public readonly pages: string[][] = [];
  private ops: string[] = [];
  private y = 0;

  public constructor(private readonly continuation: string) {
    this.firstPage();
  }

  private firstPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    // Banda de marca.
    this.ops.push(`${BRAND_RED} rg 0 ${PAGE_HEIGHT - 96} ${PAGE_WIDTH} 96 re f`);
    this.raw("F2", 22, MARGIN, PAGE_HEIGHT - 50, "LONE STAR WINNERS LLC", "1 1 1");
    this.raw("F2", 12, MARGIN, PAGE_HEIGHT - 74, "PAYMENT RECEIPT", "1 1 1");
    this.y = PAGE_HEIGHT - 130;
  }

  private nextPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.ops.push(`${BRAND_RED} rg 0 ${PAGE_HEIGHT - 8} ${PAGE_WIDTH} 8 re f`);
    this.raw("F2", 10, MARGIN, PAGE_HEIGHT - 40, this.continuation, MUTED);
    this.y = PAGE_HEIGHT - 70;
  }

  /** Garantiza `height` puntos libres por encima del pie; si no, pagina nueva. */
  public ensure(height: number): void {
    if (this.y - height < FOOTER_TOP + 12) this.nextPage();
  }

  public gap(height: number): void {
    this.y -= height;
  }

  private raw(font: Font, size: number, x: number, y: number, text: string, color = INK): void {
    this.ops.push(
      `BT ${color} rg /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${pdfString(text)} Tj ET`,
    );
  }

  public text(font: Font, size: number, text: string, color = INK, x = MARGIN): void {
    const leading = size * 1.35;
    for (const line of wrap(text, size, CONTENT_WIDTH - (x - MARGIN), font === "F2")) {
      this.ensure(leading);
      this.y -= leading;
      this.raw(font, size, x, this.y, line, color);
    }
  }

  /** Fila "Etiqueta   Valor", con el valor partido en varias lineas si hace falta. */
  public row(label: string, value: string): void {
    const size = 10.5;
    const leading = size * 1.45;
    const lines = value
      .split("\n")
      .flatMap((part) => wrap(part, size, CONTENT_WIDTH - LABEL_WIDTH, true));
    this.ensure(leading * Math.min(lines.length, 3));
    lines.forEach((line, index) => {
      this.ensure(leading);
      this.y -= leading;
      if (index === 0) this.raw("F1", size, MARGIN, this.y, label, MUTED);
      this.raw("F2", size, MARGIN + LABEL_WIDTH, this.y, line);
    });
  }

  public rule(): void {
    this.ensure(14);
    this.y -= 8;
    this.ops.push(
      `0.85 0.85 0.87 RG 0.75 w ${MARGIN} ${this.y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${this.y.toFixed(2)} l S`,
    );
    this.y -= 6;
  }

  /** Rejilla de numeros en Courier (ancho fijo: 0,6 del cuerpo por caracter). */
  public grid(numbers: readonly string[], digits: number): void {
    const size = 9.5;
    const leading = 13;
    const cell = (Math.max(digits, ...numbers.map((value) => value.length)) + 3) * size * 0.6;
    const columns = Math.max(1, Math.floor(CONTENT_WIDTH / cell));
    for (let start = 0; start < numbers.length; start += columns) {
      this.ensure(leading);
      this.y -= leading;
      numbers.slice(start, start + columns).forEach((value, column) => {
        this.raw("F3", size, MARGIN + column * cell, this.y, value);
      });
    }
  }

  /** Pie en todas las paginas, con su numero. Se llama al final. */
  public footers(): void {
    const total = this.pages.length;
    this.pages.forEach((ops, index) => {
      ops.push(
        `0.85 0.85 0.87 RG 0.75 w ${MARGIN} ${FOOTER_TOP} m ${PAGE_WIDTH - MARGIN} ${FOOTER_TOP} l S`,
      );
      let y = FOOTER_TOP - 14;
      for (const line of wrap(FOOTER_TEXT, 8.5, CONTENT_WIDTH)) {
        ops.push(`BT ${MUTED} rg /F1 8.5 Tf 1 0 0 1 ${MARGIN} ${y} Tm ${pdfString(line)} Tj ET`);
        y -= 11;
      }
      ops.push(
        `BT ${MUTED} rg /F1 8.5 Tf 1 0 0 1 ${MARGIN} ${y - 4} Tm ${pdfString(`Page ${index + 1} of ${total}`)} Tj ET`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

function lay(input: ReceiptPdfInput): Layout {
  const { receipt } = input;
  const order = receipt.order;
  const layout = new Layout(`Payment Receipt — Order ${order.order_number} (continued)`);

  if (receipt.payment_status === "PAID") {
    layout.text("F2", 15, "Payment Successful");
    layout.text(
      "F1",
      10.5,
      "Thank you for your purchase! Your payment has been confirmed and your order is complete.",
      MUTED,
    );
  } else {
    layout.text("F2", 15, `Payment status: ${STATUS_LABEL[receipt.payment_status]}`);
    layout.text(
      "F1",
      10.5,
      "This order changed after payment. The amounts and entries below are current as of the date this receipt was downloaded.",
      MUTED,
    );
  }
  layout.gap(6);
  layout.rule();

  const products = order.items
    .map((item) => {
      const name = item.product_name["en-US"] !== "" ? item.product_name["en-US"] : item.sku;
      return item.quantity === 1 ? name : `${name} × ${item.quantity.toString(10)}`;
    })
    .join("\n");

  layout.row("Order Number", order.order_number);
  layout.row("Payment Date", formatPaidAt(receipt.paid_at, input.timeZone));
  layout.row("Customer Name", receipt.customer_name ?? "—");
  layout.row("Product / Package", products === "" ? "—" : products);
  layout.row("Amount Paid", `${formatUsd(order.total.amount_minor)} ${order.total.currency}`);
  if (BigInt(receipt.refunded_total.amount_minor) > 0n) {
    layout.row(
      "Amount Refunded",
      `${formatUsd(receipt.refunded_total.amount_minor)} ${receipt.refunded_total.currency}`,
    );
  }
  layout.row("Payment Status", STATUS_LABEL[receipt.payment_status]);
  layout.row("Payment Method", order.payment_method === "CASH" ? "Cash" : "Card");
  layout.row("Number of Entries", entriesLabel(receipt));
  layout.rule();

  const numbers = receipt.entry_numbers;
  if (numbers !== null && numbers.numbers.length > 0) {
    const active = numbers.numbers.filter((row) => row.active).map((row) => row.number);
    const voided = numbers.numbers.filter((row) => !row.active).map((row) => row.number);
    layout.gap(4);
    layout.text("F2", 12, `Entry Numbers (${active.length.toLocaleString("en-US")})`);
    layout.gap(2);
    if (active.length > 0) {
      layout.grid(active, numbers.digits);
    } else {
      layout.text("F1", 10, "No active entry numbers remain for this order.", MUTED);
    }
    if (voided.length > 0) {
      layout.gap(8);
      layout.text(
        "F2",
        10.5,
        `Voided Entry Numbers (${voided.length.toLocaleString("en-US")}) — removed by a refund, chargeback or adjustment`,
        MUTED,
      );
      layout.gap(2);
      layout.grid(voided, numbers.digits);
    }
    layout.rule();
  }

  layout.gap(4);
  layout.text("F2", 10.5, "Verify your entries");
  layout.text("F1", 10, input.verifierUrl, BRAND_RED);
  layout.gap(6);
  layout.text("F2", 10.5, "Questions about your order?");
  layout.text("F1", 10, `${input.contactEmail}  •  ${input.websiteUrl}`);
  layout.text("F1", 10, "Lone Star Winners LLC", MUTED);

  layout.footers();
  return layout;
}

/** El PDF completo, listo para `reply.send`. */
export function renderReceiptPdf(input: ReceiptPdfInput): Buffer {
  const layout = lay(input);

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add(""); // se rellena al final
  const pagesId = add("");
  const helvetica = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const helveticaBold = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const courier = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  );
  const resources = `<< /Font << /F1 ${helvetica} 0 R /F2 ${helveticaBold} 0 R /F3 ${courier} 0 R >> >>`;

  const pageIds: number[] = [];
  for (const ops of layout.pages) {
    const stream = ops.join("\n");
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, "latin1").toString(10)} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length.toString(10)} >>`;
  const info = add(
    `<< /Title ${pdfString(`Payment Receipt ${input.receipt.order.order_number}`)} /Author ${pdfString("Lone Star Winners LLC")} /Producer ${pdfString("Lone Star Winners")} >>`,
  );

  // Cabecera con bytes > 0x7F: avisa a las herramientas de que es binario.
  let file = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(file, "latin1"));
    file += `${(index + 1).toString(10)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(file, "latin1");
  file += `xref\n0 ${(objects.length + 1).toString(10)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    file += `${offset.toString(10).padStart(10, "0")} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${(objects.length + 1).toString(10)} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref.toString(10)}\n%%EOF\n`;

  return Buffer.from(file, "latin1");
}
