import type { SQLInputValue } from "node:sqlite";
import type { DatabaseSync } from "../../dados/sqlite.js";
import { normalizar } from "../../lib/texto.js";
import { normalizarMunicipio, resolverUf } from "../locais-votacao/localidades.js";

export interface Cargo {
  cd: number;
  ds: string;
}

export interface Regiao {
  uf?: string;
  municipios?: { uf: string; cd: string; nome: string }[];
  zona?: number;
}

export interface Where {
  sql: string;
  params: SQLInputValue[];
}

/** Monta o WHERE de UF / municípios / zona para tabelas com colunas uf, cd_municipio, zona. */
export function whereRegiao(r: Regiao, prefixo = ""): Where {
  const partes: string[] = [];
  const params: SQLInputValue[] = [];
  if (r.uf) {
    partes.push(`${prefixo}uf = ?`);
    params.push(r.uf);
  }
  if (r.municipios?.length) {
    partes.push(`${prefixo}cd_municipio IN (${r.municipios.map(() => "?").join(", ")})`);
    params.push(...r.municipios.map((m) => m.cd));
  }
  if (r.zona !== undefined) {
    partes.push(`${prefixo}zona = ?`);
    params.push(r.zona);
  }
  return { sql: partes.length ? partes.join(" AND ") : "1 = 1", params };
}

/**
 * Resolve UF e município (nome, sem acento; aceita apelidos como "NY") usando a tabela `detalhe`.
 * Homônimos em UFs diferentes geram aviso para o modelo confirmar a UF.
 */
export function resolverRegiao(
  db: DatabaseSync,
  args: { uf?: string; municipio?: string; zona?: number },
  avisos: string[],
  tabela = "detalhe",
): Regiao {
  const r: Regiao = { zona: args.zona };
  if (args.uf) {
    const uf = resolverUf(args.uf);
    if (!uf) throw new Error(`UF desconhecida: "${args.uf}".`);
    r.uf = uf;
  }
  if (args.municipio) {
    const alvo = normalizarMunicipio(args.municipio);
    const consulta = (op: string, valor: string) =>
      db
        .prepare(
          `SELECT DISTINCT uf, cd_municipio AS cd, nm_municipio AS nome FROM ${tabela} WHERE nm_municipio_norm ${op} ?${r.uf ? " AND uf = ?" : ""} ORDER BY uf`,
        )
        .all(...([valor, ...(r.uf ? [r.uf] : [])] as SQLInputValue[])) as { uf: string; cd: string; nome: string }[];
    let ms = consulta("=", alvo);
    if (!ms.length) {
      ms = consulta("LIKE", `%${alvo}%`);
      if (ms.length) avisos.push(`Nenhum município chamado exatamente "${args.municipio}"; usando correspondência parcial.`);
    }
    if (!ms.length) throw new Error(`Município não encontrado nos resultados: "${args.municipio}"${r.uf ? ` (${r.uf})` : ""}.`);
    const ufs = new Set(ms.map((m) => m.uf));
    if (ufs.size > 1) {
      avisos.push(`"${args.municipio}" existe em ${[...ufs].join(", ")}; somando todos. Informe a UF para restringir.`);
    }
    r.municipios = ms.slice(0, 50);
  }
  return r;
}

const APELIDOS_CARGO: Record<string, string> = {
  PRESIDENCIA: "PRESIDENTE",
  "PRESIDENTE DA REPUBLICA": "PRESIDENTE",
  GOVERNO: "GOVERNADOR",
  SENADO: "SENADOR",
  PREFEITURA: "PREFEITO",
  CAMARA: "VEREADOR",
  "DEP FEDERAL": "DEPUTADO FEDERAL",
  "DEP ESTADUAL": "DEPUTADO ESTADUAL",
  "DEP DISTRITAL": "DEPUTADO DISTRITAL",
};

/** Resolve o cargo por nome (sem acento, aceita feminino e apelidos) entre os disponíveis na base. */
export function resolverCargo(disponiveis: Cargo[], entrada: string, uf?: string): Cargo {
  let alvo = normalizar(entrada)
    .replace(/\bGOVERNADORA\b/, "GOVERNADOR")
    .replace(/\bPRESIDENTA\b/, "PRESIDENTE")
    .replace(/\bSENADORA\b/, "SENADOR")
    .replace(/\bDEPUTADA\b/, "DEPUTADO")
    .replace(/\bPREFEITA\b/, "PREFEITO")
    .replace(/\bVEREADORA\b/, "VEREADOR");
  alvo = APELIDOS_CARGO[alvo] ?? alvo;
  // No DF a assembleia é a Câmara Legislativa (deputado distrital), e vice-versa.
  if (uf === "DF" && alvo === "DEPUTADO ESTADUAL") alvo = "DEPUTADO DISTRITAL";
  if (uf && uf !== "DF" && alvo === "DEPUTADO DISTRITAL") alvo = "DEPUTADO ESTADUAL";
  const norm = disponiveis.map((c) => ({ c, n: normalizar(c.ds) }));
  const achado =
    norm.find((x) => x.n === alvo) ?? norm.find((x) => x.n.startsWith(alvo)) ?? (norm.filter((x) => x.n.includes(alvo)).length === 1 ? norm.find((x) => x.n.includes(alvo)) : undefined);
  if (!achado) {
    throw new Error(`Cargo "${entrada}" não encontrado nesta eleição. Cargos disponíveis: ${disponiveis.map((c) => c.ds).join(", ")}.`);
  }
  return achado.c;
}

export function cargosDisponiveis(db: DatabaseSync, tabela = "detalhe"): Cargo[] {
  return db.prepare(`SELECT DISTINCT cd_cargo AS cd, ds_cargo AS ds FROM ${tabela} ORDER BY cd_cargo`).all() as unknown as Cargo[];
}

/** Turno padrão: o último disponível para o cargo na região. */
export function turnoPadrao(db: DatabaseSync, cargo: Cargo, regiao: Regiao, tabela = "detalhe"): { turno: number; disponiveis: number[] } {
  const w = whereRegiao(regiao);
  const linhas = db
    .prepare(`SELECT DISTINCT turno FROM ${tabela} WHERE cd_cargo = ? AND ${w.sql} ORDER BY turno`)
    .all(cargo.cd, ...w.params) as { turno: number }[];
  const disponiveis = linhas.map((l) => l.turno);
  if (!disponiveis.length) throw new Error(`Não há votação para ${cargo.ds} nessa região.`);
  return { turno: disponiveis[disponiveis.length - 1], disponiveis };
}

export const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10000) / 100 : null);

export function descreverRegiao(r: Regiao): string {
  if (r.municipios?.length) return r.municipios.map((m) => `${m.nome}/${m.uf}`).join(", ") + (r.zona ? `, zona ${r.zona}` : "");
  if (r.uf) return (r.uf === "ZZ" ? "Exterior" : r.uf) + (r.zona ? `, zona ${r.zona}` : "");
  return "Brasil (total)";
}
