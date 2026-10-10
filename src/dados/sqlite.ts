import type { Readable } from "node:stream";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { lerCsvTse, type LinhaCsv } from "./csv.js";

export { DatabaseSync };

export type Coluna = { nome: string; tipo: "TEXT" | "INTEGER" | "REAL"; valor: (l: LinhaCsv) => SQLInputValue };

export interface Tabela {
  nome: string;
  colunas: Coluna[];
  indices?: string[][];
  /** Linhas que retornam false são descartadas. */
  filtro?: (l: LinhaCsv) => boolean;
}

export function criarTabela(db: DatabaseSync, t: Tabela) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${t.nome} (${t.colunas.map((c) => `${c.nome} ${c.tipo}`).join(", ")})`);
}

export function criarIndices(db: DatabaseSync, t: Tabela) {
  for (const cols of t.indices ?? []) {
    db.exec(`CREATE INDEX IF NOT EXISTS ix_${t.nome}_${cols.join("_")} ON ${t.nome} (${cols.join(", ")})`);
  }
}

/** Importa um CSV do TSE para a tabela, em lotes transacionais. Retorna o nº de linhas inseridas. */
export async function importarCsv(db: DatabaseSync, t: Tabela, entrada: Readable): Promise<number> {
  const stmt = db.prepare(
    `INSERT INTO ${t.nome} (${t.colunas.map((c) => c.nome).join(", ")}) VALUES (${t.colunas.map(() => "?").join(", ")})`,
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for await (const linha of lerCsvTse(entrada)) {
      if (t.filtro && !t.filtro(linha)) continue;
      stmt.run(...t.colunas.map((c) => c.valor(linha)));
      if (++n % 50_000 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

export function abrirSomenteLeitura(caminho: string): DatabaseSync {
  return new DatabaseSync(caminho, { readOnly: true });
}

export function novoBanco(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;");
  return db;
}

/** Atalhos para definir colunas a partir dos nomes do CSV. */
export const col = {
  texto: (nome: string, csv = nome.toUpperCase(), f?: (v: string | undefined) => string | null): Coluna => ({
    nome,
    tipo: "TEXT",
    valor: (l) => (f ? f(l[csv]) : (l[csv] ?? null)),
  }),
  inteiro: (nome: string, csv = nome.toUpperCase()): Coluna => ({
    nome,
    tipo: "INTEGER",
    valor: (l) => {
      const v = l[csv];
      if (v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },
  }),
  decimal: (nome: string, csv = nome.toUpperCase()): Coluna => ({
    nome,
    tipo: "REAL",
    valor: (l) => {
      const v = l[csv];
      if (v === undefined || v === "") return null;
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    },
  }),
};
