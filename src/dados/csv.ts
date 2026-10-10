import type { Readable } from "node:stream";
import { parse } from "csv-parse";

export type LinhaCsv = Record<string, string>;

/** CSVs do TSE: latin1, separador ";", aspas, cabeçalho na 1ª linha. */
export function lerCsvTse(entrada: Readable): AsyncIterable<LinhaCsv> {
  return entrada.pipe(
    parse({ delimiter: ";", columns: true, encoding: "latin1", bom: true, relax_quotes: true, relax_column_count: true }),
  );
}

/** "#NULO#", "#NE#", "-1", "" → null. */
export function valorOuNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === "" || t === "#NULO#" || t === "#NULO" || t === "#NE#" || t === "#NE" || t === "-1" || t === "-3" ? null : t;
}

export function numeroOuNull(v: string | undefined): number | null {
  const t = valorOuNull(v);
  if (t === null) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Valores monetários do TSE vêm como "1234,56". */
export function decimalOuNull(v: string | undefined): number | null {
  const t = valorOuNull(v);
  if (t === null) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
