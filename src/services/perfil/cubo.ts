import { join } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { abrirSomenteLeitura, novoBanco, type DatabaseSync } from "../../dados/sqlite.js";
import { lerCsvTse } from "../../dados/csv.js";
import type { ContextoProcessamento } from "../../dados/tipos.js";
import { listarZip, paraCadaEntrada } from "../../dados/zip.js";
import { normalizar } from "../../lib/texto.js";

/**
 * Bases de perfil (eleitorado, comparecimento) têm milhões de linhas: uma por combinação de
 * município × zona × gênero × idade × instrução × cor/raça × estado civil × …
 * Guardamos duas agregações:
 * - `cubo`: por zona, cruzando gênero, faixa etária, instrução e cor/raça (permite filtros combinados);
 *   no eleitorado atual são ~4,3 milhões de linhas, contra 11 milhões do CSV;
 * - `marginal`: por zona, uma dimensão por vez (inclui as não cruzadas: estado civil, identidade de gênero…).
 */
export interface Dimensao {
  nome: string;
  rotulo: string;
  csvCd: string;
  csvDs: string;
  /** Entra no cubo cruzado. As demais só nas marginais (uma dimensão por consulta). */
  cruzada: boolean;
}

export interface EspecCubo {
  turno: boolean;
  dimensoes: Dimensao[];
  medidas: { nome: string; csv: string }[];
}

export const DIMENSOES_PERFIL: Dimensao[] = [
  { nome: "genero", rotulo: "gênero", csvCd: "CD_GENERO", csvDs: "DS_GENERO", cruzada: true },
  { nome: "faixa_etaria", rotulo: "faixa etária", csvCd: "CD_FAIXA_ETARIA", csvDs: "DS_FAIXA_ETARIA", cruzada: true },
  { nome: "grau_instrucao", rotulo: "grau de instrução", csvCd: "CD_GRAU_INSTRUCAO", csvDs: "DS_GRAU_INSTRUCAO", cruzada: true },
  { nome: "cor_raca", rotulo: "cor/raça", csvCd: "CD_COR_RACA", csvDs: "DS_COR_RACA", cruzada: true },
  { nome: "estado_civil", rotulo: "estado civil", csvCd: "CD_ESTADO_CIVIL", csvDs: "DS_ESTADO_CIVIL", cruzada: false },
  { nome: "identidade_genero", rotulo: "identidade de gênero", csvCd: "CD_IDENTIDADE_GENERO", csvDs: "DS_IDENTIDADE_GENERO", cruzada: false },
  { nome: "quilombola", rotulo: "quilombola", csvCd: "CD_QUILOMBOLA", csvDs: "DS_QUILOMBOLA", cruzada: false },
  { nome: "interprete_libras", rotulo: "intérprete de Libras", csvCd: "CD_INTERPRETE_LIBRAS", csvDs: "DS_INTERPRETE_LIBRAS", cruzada: false },
];

const inteiro = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Importa o CSV para uma tabela bruta (só códigos) e gera `cubo`, `marginal`, `rotulos` e `municipios`. */
export async function processarCubo(ctx: ContextoProcessamento, espec: EspecCubo) {
  // Alguns zips trazem um CSV por UF e também o nacional (_BRASIL): usar só o nacional evita contar em dobro.
  const { entradas, fechar } = await listarZip(ctx.zip, /\.csv$/i);
  fechar();
  const filtroEntradas = entradas.some((e) => /_BRASIL\.csv$/i.test(e.nome)) ? /_BRASIL\.csv$/i : /\.csv$/i;
  const db = novoBanco(join(ctx.destino, "dados.sqlite"));
  const dims = espec.dimensoes;
  const cruzadas = dims.filter((d) => d.cruzada).map((d) => d.nome);
  const geo = ["uf", "cd_municipio", "zona", ...(espec.turno ? ["turno"] : [])];
  const medidas = espec.medidas.map((m) => m.nome);
  const rotulos = new Map<string, string>();
  const municipios = new Map<string, [string, string, string]>();
  let geracao: string | undefined;
  let linhas = 0;
  try {
    // Tabela bruta em disco (não TEMP) e ordenações temporárias em arquivo: são milhões de linhas,
    // e manter isso na memória levaria o processo a mais de 1 GB de RAM.
    db.exec("PRAGMA temp_store = FILE");
    db.exec(`CREATE TABLE bruto (uf TEXT, cd_municipio TEXT, zona INTEGER${espec.turno ? ", turno INTEGER" : ""},
      ${dims.map((d) => `${d.nome} INTEGER`).join(", ")}, ${medidas.map((m) => `${m} INTEGER`).join(", ")})`);
    const colunas = [...geo, ...dims.map((d) => d.nome), ...medidas];
    const stmt = db.prepare(`INSERT INTO bruto VALUES (${colunas.map(() => "?").join(", ")})`);
    await paraCadaEntrada(
      ctx.zip,
      filtroEntradas,
      async (stream) => {
        db.exec("BEGIN");
        for await (const l of lerCsvTse(stream)) {
          geracao ??= l.DT_GERACAO;
          const cdMun = (l.CD_MUNICIPIO ?? "").padStart(5, "0");
          if (!municipios.has(`${l.SG_UF}-${cdMun}`)) municipios.set(`${l.SG_UF}-${cdMun}`, [l.SG_UF, cdMun, l.NM_MUNICIPIO]);
          const valores: SQLInputValue[] = [l.SG_UF, cdMun, inteiro(l.NR_ZONA)];
          if (espec.turno) valores.push(inteiro(l.NR_TURNO));
          for (const d of dims) {
            const cd = inteiro(l[d.csvCd]);
            valores.push(cd);
            const k = `${d.nome}|${cd}`;
            if (!rotulos.has(k)) rotulos.set(k, l[d.csvDs] ?? String(cd));
          }
          for (const m of espec.medidas) valores.push(inteiro(l[m.csv]));
          stmt.run(...valores);
          if (++linhas % 100_000 === 0) {
            db.exec("COMMIT");
            db.exec("BEGIN");
          }
        }
        db.exec("COMMIT");
      },
      ctx.progresso,
    );

    ctx.log(`${linhas} linhas lidas; agregando…`);
    const somas = medidas.map((m) => `SUM(${m}) AS ${m}`).join(", ");
    db.exec(`CREATE TABLE cubo AS SELECT ${[...geo, ...cruzadas].join(", ")}, ${somas} FROM bruto GROUP BY ${[...geo, ...cruzadas].join(", ")}`);
    db.exec(
      `CREATE TABLE marginal AS ` +
        dims
          .filter((d) => !d.cruzada)
          .map((d) => `SELECT ${geo.join(", ")}, '${d.nome}' AS dim, ${d.nome} AS cd, ${somas} FROM bruto GROUP BY ${geo.join(", ")}, ${d.nome}`)
          .join(" UNION ALL "),
    );
    db.exec("DROP TABLE bruto");
    db.exec(`CREATE INDEX ix_cubo ON cubo (uf, cd_municipio, zona); CREATE INDEX ix_marginal ON marginal (dim, uf, cd_municipio, zona)`);

    db.exec("CREATE TABLE rotulos (dim TEXT, cd INTEGER, ds TEXT)");
    const sr = db.prepare("INSERT INTO rotulos VALUES (?, ?, ?)");
    for (const [k, ds] of rotulos) {
      const [dim, cd] = k.split("|");
      sr.run(dim, Number(cd), ds);
    }
    db.exec("CREATE TABLE municipios (uf TEXT, cd_municipio TEXT, nm_municipio TEXT, nm_municipio_norm TEXT)");
    const sm = db.prepare("INSERT INTO municipios VALUES (?, ?, ?, ?)");
    for (const [uf, cd, nm] of municipios.values()) sm.run(uf, cd, nm, normalizar(nm));
    db.exec("ANALYZE");
  } finally {
    db.close();
  }
  // Compacta o arquivo depois de apagar a tabela bruta.
  const compactar = novoBanco(join(ctx.destino, "dados.sqlite"));
  compactar.exec("VACUUM");
  compactar.close();
  return { linhas, dataGeracao: geracao };
}

export interface BancoCubo {
  db: DatabaseSync;
  extras: Record<string, unknown>;
  fechar(): void;
}

export function abrirCubo(destino: string, extras?: Record<string, unknown>): BancoCubo {
  const db = abrirSomenteLeitura(join(destino, "dados.sqlite"));
  return { db, extras: extras ?? {}, fechar: () => db.close() };
}

// ---------------------------------------------------------------------------
// Consulta

export interface FiltrosDimensao {
  genero?: string;
  idade_min?: number;
  idade_max?: number;
  grau_instrucao?: string;
  cor_raca?: string;
  estado_civil?: string;
  identidade_genero?: string;
  quilombola?: string;
  interprete_libras?: string;
}

/** Faixa etária do TSE (1600 = 16 anos, 2124 = 21 a 24, 9999 = 100+) → [mín, máx]. */
export function faixaParaIdades(cd: number): [number, number] | null {
  if (cd < 1600) return null;
  if (cd === 9999) return [100, 150];
  if (cd <= 2000) return [cd / 100, cd / 100];
  return [Math.floor(cd / 100), cd % 100];
}

/** Converte os filtros textuais em códigos por dimensão. */
export function codigosFiltro(db: DatabaseSync, f: FiltrosDimensao): Map<string, number[]> {
  const res = new Map<string, number[]>();
  const rotulos = db.prepare("SELECT dim, cd, ds FROM rotulos").all() as { dim: string; cd: number; ds: string }[];
  for (const dim of ["genero", "grau_instrucao", "cor_raca", "estado_civil", "identidade_genero", "quilombola", "interprete_libras"] as const) {
    const valor = f[dim];
    if (!valor) continue;
    const alvo = normalizar(valor);
    const opcoes = rotulos.filter((r) => r.dim === dim).map((r) => ({ cd: r.cd, n: normalizar(r.ds), ds: r.ds }));
    let achados = opcoes.filter((o) => o.n === alvo);
    if (!achados.length) achados = opcoes.filter((o) => o.n.startsWith(alvo) || o.n.includes(alvo));
    if (!achados.length) throw new Error(`Valor "${valor}" inválido para ${dim}. Opções: ${opcoes.map((o) => o.ds).join(", ")}.`);
    res.set(dim, achados.map((o) => o.cd));
  }
  if (f.idade_min !== undefined || f.idade_max !== undefined) {
    const min = f.idade_min ?? 0;
    const max = f.idade_max ?? 200;
    const faixas = rotulos
      .filter((r) => r.dim === "faixa_etaria")
      .filter((r) => {
        const i = faixaParaIdades(r.cd);
        return i !== null && i[0] >= min && i[1] <= max;
      })
      .map((r) => r.cd);
    if (!faixas.length) throw new Error("Nenhuma faixa etária do TSE cabe inteira nesse intervalo de idades (as faixas são de 16, 17, 18, 19, 20, 21–24, 25–29… anos).");
    res.set("faixa_etaria", faixas);
  }
  return res;
}

export interface ConsultaCubo {
  where: { sql: string; params: SQLInputValue[] };
  turno?: number;
  filtros: Map<string, number[]>;
  agrupar?: string;
  medidas: string[];
  limite: number;
  ordenarPor: string;
}

/**
 * Executa sobre o cubo (dimensões cruzadas) ou, se a consulta usa estado civil, identidade de gênero,
 * quilombola ou Libras, sobre as marginais — uma dimensão por consulta.
 */
export function consultarCubo(b: BancoCubo, espec: EspecCubo, c: ConsultaCubo) {
  const geoAgrup: Record<string, { chave: string; rotulo: string }> = {
    uf: { chave: "uf", rotulo: "CASE uf WHEN 'ZZ' THEN 'Exterior' ELSE uf END" },
    municipio: { chave: "uf, cd_municipio", rotulo: "(SELECT nm_municipio FROM municipios m WHERE m.uf = t.uf AND m.cd_municipio = t.cd_municipio) || '/' || uf" },
    zona: { chave: "uf, zona", rotulo: "'Zona ' || zona || '/' || uf" },
  };
  const cruzadas = new Set(espec.dimensoes.filter((d) => d.cruzada).map((d) => d.nome));
  const dimsUsadas = new Set([...c.filtros.keys(), ...(c.agrupar && !geoAgrup[c.agrupar] ? [c.agrupar] : [])]);
  const precisaMarginal = [...dimsUsadas].some((d) => !cruzadas.has(d));
  if (precisaMarginal && dimsUsadas.size > 1) {
    throw new Error(
      "Estado civil, identidade de gênero, quilombola e Libras não se combinam com outras dimensões: use uma dimensão por vez " +
        "(filtro ou agrupamento). Gênero, idade, instrução e cor/raça podem ser combinados entre si.",
    );
  }

  const conds = [c.where.sql];
  const params = [...c.where.params];
  if (espec.turno && c.turno !== undefined) {
    conds.push("turno = ?");
    params.push(c.turno);
  }
  let tabela = "cubo";
  if (precisaMarginal) {
    tabela = "marginal";
    const dim = [...dimsUsadas][0];
    conds.push("dim = ?");
    params.push(dim);
    const cds = c.filtros.get(dim);
    if (cds) {
      conds.push(`cd IN (${cds.map(() => "?").join(", ")})`);
      params.push(...cds);
    }
  } else {
    for (const [dim, cds] of c.filtros) {
      conds.push(`${dim} IN (${cds.map(() => "?").join(", ")})`);
      params.push(...cds);
    }
  }
  const somas = c.medidas.map((m) => `SUM(${m}) AS ${m}`).join(", ");
  const where = conds.join(" AND ");
  const total = b.db.prepare(`SELECT ${somas} FROM ${tabela} t WHERE ${where}`).get(...params) as Record<string, number>;

  let grupos: Record<string, unknown>[] | undefined;
  if (c.agrupar) {
    const g = geoAgrup[c.agrupar];
    const colDim = precisaMarginal ? "cd" : c.agrupar;
    const chave = g ? g.chave : colDim;
    const rotulo = g ? g.rotulo : `(SELECT ds FROM rotulos r WHERE r.dim = '${c.agrupar}' AND r.cd = t.${colDim})`;
    const ordem = g ? `${c.ordenarPor} DESC` : `${colDim}`;
    grupos = b.db
      .prepare(`SELECT ${rotulo} AS grupo, ${somas} FROM ${tabela} t WHERE ${where} GROUP BY ${chave} ORDER BY ${ordem} LIMIT ?`)
      .all(...params, c.limite) as Record<string, unknown>[];
  }
  return { total, grupos, tabela };
}

export const CAMPOS_AGRUPAR = ["uf", "municipio", "zona", ...DIMENSOES_PERFIL.map((d) => d.nome)] as const;
