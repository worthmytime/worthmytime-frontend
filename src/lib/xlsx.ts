import { strFromU8, unzipSync } from "fflate";

/**
 * Odczyt pierwszego arkusza pliku XLSX w przeglądarce (plik nie jest nigdzie wysyłany).
 * Zwraca wiersze jako tekst: liczby tak, jak są zapisane w pliku, a daty jako YYYY-MM-DD.
 */

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Format liczbowy jest datą, gdy po odrzuceniu tekstów w cudzysłowach i nawiasach zawiera znaczniki dnia, miesiąca lub roku. */
const isDateFormat = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, ""));

const xml = (bytes: Uint8Array | undefined) => (bytes ? new DOMParser().parseFromString(strFromU8(bytes), "application/xml") : null);

const all = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagName(tag));

/** Numer kolumny z adresu komórki: A1 -> 0, AB12 -> 27. */
function columnIndex(ref: string | null): number | null {
  const letters = /^[A-Z]+/.exec(ref ?? "")?.[0];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Numer seryjny Excela (dni od 1899-12-30) jako YYYY-MM-DD. */
function serialToDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function readXlsx(buffer: ArrayBuffer): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("Nie udało się otworzyć pliku. Obsługujemy arkusze XLSX (starszy format XLS zapisz jako XLSX lub CSV).");
  }

  const shared = all(xml(files["xl/sharedStrings.xml"]) ?? document.implementation.createDocument(null, "sst"), "si").map((si) =>
    all(si, "t")
      .filter((t) => t.parentElement?.tagName !== "rPh") // zapis fonetyczny nie jest częścią tekstu
      .map((t) => t.textContent ?? "")
      .join(""),
  );

  // style komórek: które z nich formatują liczbę jako datę
  const styles = xml(files["xl/styles.xml"]);
  const custom = new Map<number, string>();
  let dateStyles: boolean[] = [];
  if (styles) {
    for (const f of all(styles, "numFmt")) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
    const cellXfs = all(styles, "cellXfs")[0];
    dateStyles = (cellXfs ? all(cellXfs, "xf") : []).map((xf) => {
      const id = Number(xf.getAttribute("numFmtId") ?? 0);
      return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!));
    });
  }

  // pierwszy arkusz z kolejności w skoroszycie; gdy nie da się ustalić, pierwszy plik arkusza
  const sheetPaths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let sheetPath = sheetPaths[0];
  const workbook = xml(files["xl/workbook.xml"]);
  const rels = xml(files["xl/_rels/workbook.xml.rels"]);
  const firstSheet = workbook ? all(workbook, "sheet")[0] : undefined;
  const relId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const target = rels && relId ? all(rels, "Relationship").find((r) => r.getAttribute("Id") === relId)?.getAttribute("Target") : null;
  if (target) {
    const resolved = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (files[resolved]) sheetPath = resolved;
  }
  const sheet = xml(files[sheetPath]);
  if (!sheet) throw new Error("W pliku nie ma arkusza z danymi.");

  const rows: string[][] = [];
  for (const row of all(sheet, "row")) {
    const cells: string[] = [];
    let next = 0;
    for (const c of all(row, "c")) {
      const at = columnIndex(c.getAttribute("r")) ?? next;
      next = at + 1;
      const type = c.getAttribute("t");
      const raw = all(c, "v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = all(c, "t").map((t) => t.textContent ?? "").join("");
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "str" || type === "e") value = raw;
      else if (raw !== "" && dateStyles[Number(c.getAttribute("s") ?? -1)] && Number.isFinite(Number(raw))) value = serialToDate(Number(raw));
      else value = raw;
      while (cells.length < at) cells.push("");
      cells[at] = value.trim();
    }
    if (cells.some((v) => v !== "")) rows.push(cells);
  }
  return rows;
}
