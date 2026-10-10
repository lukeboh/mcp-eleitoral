import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import type { ParametrosBase } from "../../dados/tipos.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { normalizar } from "../../lib/texto.js";
import type { RepositorioLocais } from "../locais-votacao/repositorio.js";
import type { BancoResultados } from "./bases.js";
import {
  cargosDisponiveis,
  descreverRegiao,
  pct,
  resolverCargo,
  resolverRegiao,
  turnoPadrao,
  whereRegiao,
  type Cargo,
  type Regiao,
} from "./filtros.js";

const regiaoSchema = {
  uf: z.string().optional().describe('UF (sigla ou nome). "exterior" para votos no exterior.'),
  municipio: z.string().optional().describe('Município (sem acento ok). No exterior, a cidade em português (ex.: "NOVA YORK").'),
  zona: z.number().int().positive().optional().describe("Zona eleitoral (combine com `uf`)."),
};

const eleicaoSchema = {
  ano: z.number().int().optional().describe("Ano da eleição. Padrão: a mais recente."),
  turno: z.number().int().min(1).max(2).optional().describe("Turno. Padrão: o último disponível para o cargo."),
};

const ROTULO_UF = "CASE uf WHEN 'ZZ' THEN 'Exterior' ELSE uf END";

const SITUACOES_ELEITO = new Set(["ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA"]);

function fonte(id: string, ano: number | undefined, extra?: string) {
  return {
    descricao: `TSE - Portal de Dados Abertos, Resultados ${ano ?? ""}${extra ? ` (${extra})` : ""}`.trim(),
    base: id,
    url: `https://dadosabertos.tse.jus.br/dataset/resultados-${ano}`,
  };
}

interface Totais {
  aptos: number;
  comparecimento: number;
  abstencoes: number;
  votos_validos: number;
  votos_brancos: number;
  votos_nulos: number;
  secoes: number;
  totalizado_em: string | null;
}

function totaisDetalhe(det: BancoResultados, cargo: Cargo, turno: number, regiao: Regiao): Totais {
  const w = whereRegiao(regiao);
  return det.db
    .prepare(
      `SELECT SUM(aptos) aptos, SUM(comparecimento) comparecimento, SUM(abstencoes) abstencoes, SUM(votos_validos) votos_validos,
              SUM(votos_brancos) votos_brancos, SUM(votos_nulos) votos_nulos, SUM(secoes) secoes, MAX(totalizado_em) totalizado_em
       FROM detalhe WHERE cd_cargo = ? AND turno = ? AND ${w.sql}`,
    )
    .get(cargo.cd, turno, ...w.params) as unknown as Totais;
}

function resumoTotais(t: Totais) {
  return {
    eleitores_aptos: t.aptos,
    comparecimento: t.comparecimento,
    comparecimento_pct: pct(t.comparecimento, t.aptos),
    abstencoes: t.abstencoes,
    abstencao_pct: pct(t.abstencoes, t.aptos),
    votos_validos: t.votos_validos,
    votos_brancos: t.votos_brancos,
    brancos_pct: pct(t.votos_brancos, t.comparecimento),
    votos_nulos: t.votos_nulos,
    nulos_pct: pct(t.votos_nulos, t.comparecimento),
    secoes: t.secoes,
  };
}

/** Abre a base de detalhe (pequena) e resolve região, cargo e turno. */
async function contextoEleicao(
  ctx: Contexto,
  args: { ano?: number; turno?: number; cargo?: string; uf?: string; municipio?: string; zona?: number },
  avisos: string[],
  cargoPadrao?: (cargos: Cargo[]) => Cargo,
) {
  const det = await ctx.bases.obter<BancoResultados>("resultados-detalhe", { ano: args.ano });
  const ano = (await ctx.bases.resolver("resultados-detalhe", { ano: args.ano })).ano;
  const regiao = resolverRegiao(det.db, args, avisos);
  const cargos = cargosDisponiveis(det.db);
  const cargo = args.cargo ? resolverCargo(cargos, args.cargo, regiao.uf ?? regiao.municipios?.[0]?.uf) : cargoPadrao?.(cargos);
  if (!cargo) throw new Error(`Informe o cargo. Disponíveis: ${cargos.map((c) => c.ds).join(", ")}.`);
  const { turno: ultimo, disponiveis } = turnoPadrao(det.db, cargo, regiao);
  const turno = args.turno ?? ultimo;
  if (!disponiveis.includes(turno)) throw new Error(`Não há ${turno}º turno para ${cargo.ds} nessa região (turnos: ${disponiveis.join(", ")}).`);
  return { det, ano, regiao, cargo, turno, turnos_disponiveis: disponiveis };
}

export function registrarResultados(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "resultado_eleicao",
    {
      title: "Resultado da eleição",
      description:
        "Ranking de votação de um cargo (presidente, governador, senador, deputado, prefeito, vereador) no Brasil, " +
        'numa UF, num município ou numa zona, com % dos votos válidos e situação (eleito, 2º turno…). Ex.: "quem ganhou ' +
        'para governador no DF?", "como foi a votação para presidente em Campinas?". Com agrupar_por="partido", ' +
        "mostra a votação por partido (nominal + legenda), útil para deputados e vereadores. Inclui comparecimento, brancos e nulos.",
      inputSchema: {
        cargo: z.string().describe('Cargo, ex.: "presidente", "governador", "deputado federal".'),
        ...regiaoSchema,
        ...eleicaoSchema,
        agrupar_por: z.enum(["candidato", "partido"]).optional().describe('Padrão: "candidato".'),
        limite: z.number().int().min(1).max(100).optional().describe("Quantos itens do ranking (padrão 10)."),
      },
    },
    comTratamento(async (args) => {
      const avisos: string[] = [];
      const e = await contextoEleicao(ctx, args, avisos);
      const totais = totaisDetalhe(e.det, e.cargo, e.turno, e.regiao);
      const w = whereRegiao(e.regiao);
      const limite = args.limite ?? 10;
      let ranking: unknown[];
      let id: string;
      if (args.agrupar_por === "partido") {
        id = "resultados-partidos";
        const p = await ctx.bases.obter<BancoResultados>(id, { ano: e.ano });
        const linhas = p.db
          .prepare(
            `SELECT partido, MAX(federacao) federacao, SUM(votos_nominais) nominais, SUM(votos_legenda) legenda
             FROM partidos WHERE cd_cargo = ? AND turno = ? AND ${w.sql}
             GROUP BY partido ORDER BY nominais + legenda DESC LIMIT ?`,
          )
          .all(e.cargo.cd, e.turno, ...w.params, limite) as { partido: string; federacao: string | null; nominais: number; legenda: number }[];
        ranking = linhas.map((l) => ({
          partido: l.partido,
          federacao: l.federacao ?? undefined,
          votos: l.nominais + l.legenda,
          votos_nominais: l.nominais,
          votos_legenda: l.legenda,
          percentual_validos: pct(l.nominais + l.legenda, totais.votos_validos),
        }));
      } else {
        id = "resultados-candidatos";
        const c = await ctx.bases.obter<BancoResultados>(id, { ano: e.ano });
        const linhas = c.db
          .prepare(
            `SELECT v.sq_candidato, SUM(v.votos) votos, k.nome_urna, k.nome, k.numero, k.partido, k.federacao, k.situacao, k.uf AS uf_candidatura
             FROM votos v JOIN candidatos k ON k.sq_candidato = v.sq_candidato AND k.turno = v.turno
             WHERE v.cd_cargo = ? AND v.turno = ? AND ${whereRegiao(e.regiao, "v.").sql}
             GROUP BY v.sq_candidato ORDER BY votos DESC LIMIT ?`,
          )
          .all(e.cargo.cd, e.turno, ...w.params, limite) as Record<string, string | number>[];
        ranking = linhas.map((l) => ({
          candidato: l.nome_urna,
          nome_completo: l.nome,
          numero: l.numero,
          partido: l.partido,
          federacao: l.federacao ?? undefined,
          votos: l.votos,
          percentual_validos: pct(Number(l.votos), totais.votos_validos),
          situacao_na_eleicao: l.situacao,
          eleito: SITUACOES_ELEITO.has(String(l.situacao)),
          candidatura_em: l.uf_candidatura,
        }));
        if (e.regiao.municipios || e.regiao.zona) {
          avisos.push("`situacao_na_eleicao` refere-se ao resultado da eleição inteira (país/UF), não só à região filtrada.");
        }
      }
      return respostaJson({
        cargo: e.cargo.ds,
        regiao: descreverRegiao(e.regiao),
        turno: e.turno,
        turnos_disponiveis: e.turnos_disponiveis,
        ranking,
        totais: resumoTotais(totais),
        totalizado_em: totais.totalizado_em,
        avisos: avisos.length ? avisos : undefined,
        fonte: fonte(id, e.ano),
      });
    }),
  );

  server.registerTool(
    "votos_candidato",
    {
      title: "Votos de um candidato",
      description:
        "Votação de um candidato (por nome de urna, nome completo ou número), com o total e a distribuição por UF, " +
        'município ou zona e o % dos válidos em cada lugar. Ex.: "quantos votos fulano teve em Campinas?", ' +
        '"onde fulana foi mais votada?" (ordenar_por="percentual"). Se o nome casar com vários candidatos, devolve a lista para escolher.',
      inputSchema: {
        nome: z.string().optional().describe("Nome de urna ou parte do nome completo."),
        numero: z.number().int().optional().describe("Número do candidato na urna."),
        cargo: z.string().optional(),
        uf_candidatura: z.string().optional().describe("UF onde concorreu (para desambiguar)."),
        ...regiaoSchema,
        ...eleicaoSchema,
        agrupar_por: z.enum(["uf", "municipio", "zona"]).optional().describe('Padrão: "municipio".'),
        ordenar_por: z.enum(["votos", "percentual"]).optional().describe('Padrão: "votos".'),
        limite: z.number().int().min(1).max(200).optional().describe("Padrão 20."),
      },
    },
    comTratamento(async (args) => {
      if (!args.nome && args.numero === undefined) throw new Error("Informe `nome` ou `numero`.");
      const avisos: string[] = [];
      const det = await ctx.bases.obter<BancoResultados>("resultados-detalhe", { ano: args.ano });
      const ano = (await ctx.bases.resolver("resultados-detalhe", { ano: args.ano })).ano;
      const c = await ctx.bases.obter<BancoResultados>("resultados-candidatos", { ano });

      const conds: string[] = [];
      const params: SQLInputValue[] = [];
      if (args.nome) {
        conds.push("nome_norm LIKE ?");
        params.push(`%${normalizar(args.nome)}%`);
      }
      if (args.numero !== undefined) {
        conds.push("numero = ?");
        params.push(args.numero);
      }
      if (args.cargo) {
        const cargo = resolverCargo(cargosDisponiveis(det.db), args.cargo, args.uf_candidatura?.toUpperCase());
        conds.push("cd_cargo = ?");
        params.push(cargo.cd);
      }
      if (args.uf_candidatura) {
        conds.push("uf = ?");
        params.push(args.uf_candidatura.toUpperCase() === "BRASIL" ? "BR" : args.uf_candidatura.toUpperCase());
      }
      const candidatos = c.db
        .prepare(
          `SELECT sq_candidato, MAX(turno) ultimo_turno, nome_urna, nome, numero, partido, ds_cargo, cd_cargo, uf
           FROM candidatos WHERE ${conds.join(" AND ")} GROUP BY sq_candidato LIMIT 30`,
        )
        .all(...params) as { sq_candidato: number; ultimo_turno: number; nome_urna: string; nome: string; numero: number; partido: string; ds_cargo: string; cd_cargo: number; uf: string }[];
      if (!candidatos.length) throw new Error("Nenhum candidato encontrado com esses dados nesta eleição.");
      if (candidatos.length > 1) {
        return respostaJson({
          mensagem: "Vários candidatos correspondem. Pergunte ao usuário qual é e refaça com `numero`, `cargo` e `uf_candidatura`.",
          candidatos: candidatos.map((k) => ({ candidato: k.nome_urna, nome_completo: k.nome, numero: k.numero, partido: k.partido, cargo: k.ds_cargo, uf: k.uf })),
        });
      }

      const k = candidatos[0];
      const turno = args.turno ?? k.ultimo_turno;
      const ficha = c.db.prepare("SELECT * FROM candidatos WHERE sq_candidato = ? AND turno = ?").get(k.sq_candidato, turno) as Record<string, unknown> | undefined;
      if (!ficha) throw new Error(`O candidato não disputou o ${turno}º turno.`);
      const regiao = resolverRegiao(det.db, args, avisos);
      const w = whereRegiao(regiao);
      const agrupar = args.agrupar_por ?? "municipio";
      const chave = agrupar === "uf" ? "uf" : agrupar === "municipio" ? "uf, cd_municipio" : "uf, zona";
      const rotulo = agrupar === "uf" ? ROTULO_UF : agrupar === "municipio" ? "MAX(nm_municipio) || '/' || uf" : "'Zona ' || zona || '/' || uf";

      const votos = c.db
        .prepare(`SELECT ${chave}, ${rotulo} AS local, SUM(votos) votos FROM votos WHERE sq_candidato = ? AND turno = ? AND ${w.sql} GROUP BY ${chave}`)
        .all(k.sq_candidato, turno, ...w.params) as Record<string, string | number>[];
      const validos = det.db
        .prepare(`SELECT ${chave}, SUM(votos_validos) validos FROM detalhe WHERE cd_cargo = ? AND turno = ? AND ${w.sql} GROUP BY ${chave}`)
        .all(k.cd_cargo, turno, ...w.params) as Record<string, string | number>[];
      const id = (l: Record<string, string | number>) => chave.split(", ").map((x) => l[x]).join("|");
      const mapaValidos = new Map(validos.map((v) => [id(v), Number(v.validos)]));
      const grupos = votos.map((v) => ({ local: String(v.local), votos: Number(v.votos), percentual_validos: pct(Number(v.votos), mapaValidos.get(id(v)) ?? 0) }));
      const ordenar = args.ordenar_por === "percentual" ? (a: (typeof grupos)[0], b: (typeof grupos)[0]) => (b.percentual_validos ?? 0) - (a.percentual_validos ?? 0) : (a: (typeof grupos)[0], b: (typeof grupos)[0]) => b.votos - a.votos;
      grupos.sort(ordenar);
      const total = grupos.reduce((s, g) => s + g.votos, 0);
      const totalValidos = [...mapaValidos.values()].reduce((s, x) => s + x, 0);

      return respostaJson({
        candidato: ficha.nome_urna,
        nome_completo: ficha.nome,
        numero: ficha.numero,
        partido: ficha.partido,
        cargo: ficha.ds_cargo,
        candidatura_em: ficha.uf,
        situacao_na_eleicao: ficha.situacao,
        turno,
        regiao: descreverRegiao(regiao),
        total_votos: total,
        percentual_validos: pct(total, totalValidos),
        [`por_${agrupar}`]: grupos.slice(0, args.limite ?? 20),
        lugares_com_voto: grupos.length,
        avisos: avisos.length ? avisos : undefined,
        fonte: fonte("resultados-candidatos", ano),
      });
    }),
  );

  server.registerTool(
    "comparecimento_abstencao",
    {
      title: "Comparecimento, abstenção, brancos e nulos",
      description:
        "Eleitores aptos, comparecimento, abstenção, brancos e nulos no Brasil, numa UF, município ou zona; com " +
        'agrupar_por, compara lugares (ex.: "quais capitais tiveram mais abstenção?", "abstenção por zona no DF"). ' +
        "Base pequena, baixada automaticamente.",
      inputSchema: {
        ...regiaoSchema,
        ...eleicaoSchema,
        cargo: z.string().optional().describe("Cargo de referência (padrão: presidente nas eleições gerais, prefeito nas municipais)."),
        agrupar_por: z.enum(["uf", "municipio", "zona"]).optional(),
        ordenar_por: z.enum(["abstencao", "comparecimento", "brancos", "nulos", "eleitores"]).optional().describe('Padrão: "abstencao".'),
        ordem: z.enum(["desc", "asc"]).optional().describe('Padrão: "desc" (maiores primeiro).'),
        limite: z.number().int().min(1).max(200).optional().describe("Padrão 20."),
      },
    },
    comTratamento(async (args) => {
      const avisos: string[] = [];
      const e = await contextoEleicao(ctx, args, avisos, (cargos) =>
        cargos.find((c) => /presidente|prefeito/i.test(c.ds)) ?? cargos[0],
      );
      const totais = totaisDetalhe(e.det, e.cargo, e.turno, e.regiao);
      let grupos: unknown;
      if (args.agrupar_por) {
        const w = whereRegiao(e.regiao);
        const chave = args.agrupar_por === "uf" ? "uf" : args.agrupar_por === "municipio" ? "uf, cd_municipio" : "uf, zona";
        const rotulo = args.agrupar_por === "uf" ? ROTULO_UF : args.agrupar_por === "municipio" ? "MAX(nm_municipio) || '/' || uf" : "'Zona ' || zona || '/' || uf";
        const expr = {
          abstencao: "1.0 * SUM(abstencoes) / SUM(aptos)",
          comparecimento: "1.0 * SUM(comparecimento) / SUM(aptos)",
          brancos: "1.0 * SUM(votos_brancos) / SUM(comparecimento)",
          nulos: "1.0 * SUM(votos_nulos) / SUM(comparecimento)",
          eleitores: "SUM(aptos)",
        }[args.ordenar_por ?? "abstencao"];
        const linhas = e.det.db
          .prepare(
            `SELECT ${rotulo} AS local, SUM(aptos) aptos, SUM(comparecimento) comparecimento, SUM(abstencoes) abstencoes, SUM(votos_validos) votos_validos,
                    SUM(votos_brancos) votos_brancos, SUM(votos_nulos) votos_nulos, SUM(secoes) secoes, NULL totalizado_em
             FROM detalhe WHERE cd_cargo = ? AND turno = ? AND ${w.sql} GROUP BY ${chave}
             ORDER BY ${expr} ${args.ordem === "asc" ? "ASC" : "DESC"} LIMIT ?`,
          )
          .all(e.cargo.cd, e.turno, ...w.params, args.limite ?? 20) as unknown as (Totais & { local: string })[];
        grupos = linhas.map((l) => ({ local: l.local, ...resumoTotais(l) }));
      }
      return respostaJson({
        regiao: descreverRegiao(e.regiao),
        cargo_referencia: e.cargo.ds,
        turno: e.turno,
        turnos_disponiveis: e.turnos_disponiveis,
        ...resumoTotais(totais),
        grupos,
        avisos: avisos.length ? avisos : undefined,
        fonte: fonte("resultados-detalhe", e.ano),
      });
    }),
  );

  server.registerTool(
    "resultado_local_votacao",
    {
      title: "Resultado por local de votação ou seção",
      description:
        "Como votaram os eleitores de um local de votação (escola), de uma seção, de um bairro ou de uma zona. " +
        'Ex.: "quem ganhou para governador na Escola Classe 206 Sul?", "resultado da seção 579 da zona 1 do DF", ' +
        '"como votou o bairro Asa Sul?". Usa a base de votação por seção da UF; para presidente usa a base nacional (uf="BR" no download). ' +
        "O filtro por bairro usa também a base de locais de votação.",
      inputSchema: {
        uf: z.string().describe('UF (sigla ou nome) ou "exterior".'),
        cargo: z.string().describe('Cargo, ex.: "governador", "presidente".'),
        municipio: z.string().optional(),
        zona: z.number().int().positive().optional(),
        secao: z.number().int().positive().optional().describe("Seção (exige `zona`)."),
        local: z.string().optional().describe('Trecho do nome do local de votação (ex.: "escola classe 206 sul").'),
        numero_local: z.number().int().optional().describe("Número do local (NR_LOCAL_VOTACAO), com `zona`."),
        bairro: z.string().optional().describe("Bairro (soma todos os locais de votação do bairro)."),
        ...eleicaoSchema,
        limite: z.number().int().min(1).max(100).optional().describe("Padrão 10."),
      },
    },
    comTratamento(async (args) => {
      const avisos: string[] = [];
      const det = await ctx.bases.obter<BancoResultados>("resultados-detalhe", { ano: args.ano });
      const ano = (await ctx.bases.resolver("resultados-detalhe", { ano: args.ano })).ano;
      const regiao = resolverRegiao(det.db, { uf: args.uf, municipio: args.municipio }, avisos);
      const uf = regiao.uf!;
      const cargo = resolverCargo(cargosDisponiveis(det.db), args.cargo, uf);
      const nacional = /presidente/i.test(cargo.ds);
      const paramsBase: ParametrosBase = { ano, uf: nacional ? "BR" : uf };
      const s = await ctx.bases.obter<BancoResultados>("votacao-secao", paramsBase);

      // Locais de votação selecionados (cd_municipio, zona, nr_local).
      const conds: string[] = ["uf = ?"];
      const params: SQLInputValue[] = [uf];
      if (regiao.municipios) {
        conds.push(`cd_municipio IN (${regiao.municipios.map(() => "?").join(", ")})`);
        params.push(...regiao.municipios.map((m) => m.cd));
      }
      if (args.zona !== undefined) {
        conds.push("zona = ?");
        params.push(args.zona);
      }
      if (args.numero_local !== undefined) {
        conds.push("nr_local = ?");
        params.push(args.numero_local);
      }
      if (args.local) {
        conds.push("nome_norm LIKE ?");
        params.push(`%${normalizar(args.local)}%`);
      }
      let locais = s.db
        .prepare(`SELECT cd_municipio, nm_municipio, zona, nr_local, nome, endereco FROM locais WHERE ${conds.join(" AND ")}`)
        .all(...params) as { cd_municipio: string; nm_municipio: string; zona: number; nr_local: number; nome: string; endereco: string }[];
      if (args.bairro) {
        const repo = await ctx.bases.obter<RepositorioLocais>("locais-votacao", {});
        const doBairro = new Set(
          repo.filtrar({ uf, bairro: args.bairro, incluirEspeciais: true, incluirInativos: true }).locais.map((l) => `${l.codigoMunicipio}-${l.zona}-${l.numero}`),
        );
        locais = locais.filter((l) => doBairro.has(`${l.cd_municipio}-${l.zona}-${l.nr_local}`));
      }
      if (!locais.length) throw new Error("Nenhum local de votação encontrado com esses filtros.");
      if (args.secao !== undefined && args.zona === undefined) throw new Error("Para filtrar por seção, informe também a `zona`.");

      const tuplas = locais.map(() => "(?, ?, ?)").join(", ");
      const tParams = locais.flatMap((l) => [l.cd_municipio, l.zona, l.nr_local]);
      const condSecao = args.secao !== undefined ? " AND secao = ?" : "";
      const sParams = args.secao !== undefined ? [args.secao] : [];
      const turnos = (s.db.prepare(`SELECT DISTINCT turno FROM secao WHERE cd_cargo = ? ORDER BY turno`).all(cargo.cd) as { turno: number }[]).map((t) => t.turno);
      if (!turnos.length) throw new Error(`A base de seções ${paramsBase.uf} não tem votação para ${cargo.ds}.`);
      const turno = args.turno ?? turnos[turnos.length - 1];
      const linhas = s.db
        .prepare(
          `SELECT s.nr_votavel, MAX(v.nome) nome, SUM(s.votos) votos, COUNT(DISTINCT s.zona || '-' || s.secao) secoes
           FROM secao s LEFT JOIN votaveis v ON v.cd_cargo = s.cd_cargo AND v.nr_votavel = s.nr_votavel
           WHERE s.cd_cargo = ? AND s.turno = ? AND (s.cd_municipio, s.zona, s.nr_local) IN (VALUES ${tuplas})${condSecao}
           GROUP BY s.nr_votavel ORDER BY votos DESC`,
        )
        .all(cargo.cd, turno, ...tParams, ...sParams) as { nr_votavel: number; nome: string; votos: number; secoes: number }[];
      if (!linhas.length) throw new Error("Nenhum voto encontrado para esse filtro (confira zona/seção e turno).");

      const tipo = (n: number) => (n === 95 ? "branco" : n === 96 ? "nulo" : n === 97 ? "anulado" : n < 100 && !/presidente|governador|senador|prefeito/i.test(cargo.ds) ? "legenda" : "candidato");
      const validos = linhas.filter((l) => ["candidato", "legenda"].includes(tipo(l.nr_votavel))).reduce((s, l) => s + l.votos, 0);
      const total = linhas.reduce((s, l) => s + l.votos, 0);
      const secoes = (s.db
        .prepare(`SELECT COUNT(DISTINCT zona || '-' || secao) n FROM secao WHERE cd_cargo = ? AND turno = ? AND (cd_municipio, zona, nr_local) IN (VALUES ${tuplas})${condSecao}`)
        .get(cargo.cd, turno, ...tParams, ...sParams) as { n: number }).n;

      return respostaJson({
        cargo: cargo.ds,
        turno,
        turnos_disponiveis: turnos,
        locais: locais.slice(0, 15).map((l) => ({ nome: l.nome, endereco: l.endereco, municipio: l.nm_municipio, zona: l.zona, numero_local: l.nr_local })),
        total_locais: locais.length,
        secoes,
        votos_apurados: total,
        votos_validos: validos,
        ranking: linhas
          .filter((l) => ["candidato", "legenda"].includes(tipo(l.nr_votavel)))
          .slice(0, args.limite ?? 10)
          .map((l) => ({ nome: l.nome, numero: l.nr_votavel, tipo: tipo(l.nr_votavel), votos: l.votos, percentual_validos: pct(l.votos, validos) })),
        brancos: linhas.find((l) => l.nr_votavel === 95)?.votos ?? 0,
        nulos: linhas.filter((l) => l.nr_votavel === 96 || l.nr_votavel === 97).reduce((s, l) => s + l.votos, 0),
        avisos: avisos.length ? avisos : undefined,
        fonte: fonte("votacao-secao", ano, `votação por seção, ${paramsBase.uf}`),
      });
    }),
  );
}
