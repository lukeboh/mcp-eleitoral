import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { normalizar } from "../../lib/texto.js";
import { resolverUf } from "../locais-votacao/localidades.js";
import { cargosDisponiveis, pct, resolverCargo } from "../resultados/filtros.js";
import type { BancoCandidatos } from "./bases.js";

const SITUACOES: Record<string, string[]> = {
  eleito: ["ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA"],
  segundo_turno: ["2º TURNO"],
  suplente: ["SUPLENTE"],
  nao_eleito: ["NÃO ELEITO"],
};

const filtrosSchema = {
  nome: z.string().optional().describe("Nome de urna ou parte do nome completo."),
  numero: z.number().int().optional().describe("Número na urna."),
  cargo: z.string().optional().describe('Ex.: "governador", "deputado federal", "1º suplente".'),
  uf: z.string().optional().describe('UF da candidatura (sigla/nome). "BR" para presidente.'),
  partido: z.string().optional().describe('Sigla do partido (ex.: "PT", "PL").'),
  situacao: z.enum(["eleito", "segundo_turno", "suplente", "nao_eleito"]).optional().describe("Resultado no turno."),
  genero: z.string().optional().describe('"feminino" ou "masculino".'),
  cor_raca: z.string().optional().describe('Ex.: "preta", "parda", "branca", "indígena".'),
  ocupacao: z.string().optional().describe("Trecho da ocupação declarada."),
  apenas_aptos: z.boolean().optional().describe("Só candidaturas deferidas/aptas (padrão: false)."),
  ano: z.number().int().optional().describe("Ano da eleição. Padrão: a mais recente."),
};

type Filtros = {
  nome?: string;
  numero?: number;
  cargo?: string;
  uf?: string;
  partido?: string;
  situacao?: keyof typeof SITUACOES;
  genero?: string;
  cor_raca?: string;
  ocupacao?: string;
  apenas_aptos?: boolean;
};

const FONTE = (ano?: number) => ({
  descricao: `TSE - Portal de Dados Abertos, Candidatos ${ano ?? ""}`.trim(),
  url: `https://dadosabertos.tse.jus.br/dataset/candidatos-${ano}`,
});

/** WHERE sobre `candidaturas` (alias c). Considera o último turno de cada candidato. */
function whereCandidaturas(db: BancoCandidatos["db"], f: Filtros) {
  const conds = ["c.turno = (SELECT MAX(turno) FROM candidaturas x WHERE x.sq_candidato = c.sq_candidato)"];
  const params: SQLInputValue[] = [];
  let uf: string | undefined;
  if (f.uf) {
    uf = /^(BR|BRASIL)$/i.test(f.uf.trim()) ? "BR" : resolverUf(f.uf);
    if (!uf) throw new Error(`UF desconhecida: "${f.uf}".`);
    conds.push("c.uf = ?");
    params.push(uf);
  }
  if (f.cargo) {
    const cargo = resolverCargo(cargosDisponiveis(db, "candidaturas"), f.cargo, uf);
    conds.push("c.cd_cargo = ?");
    params.push(cargo.cd);
  }
  if (f.nome) {
    conds.push("c.nome_norm LIKE ?");
    params.push(`%${normalizar(f.nome)}%`);
  }
  if (f.numero !== undefined) {
    conds.push("c.numero = ?");
    params.push(f.numero);
  }
  if (f.partido) {
    conds.push("UPPER(REPLACE(c.partido, ' ', '')) = ?");
    params.push(f.partido.toUpperCase().replace(/\s/g, ""));
  }
  if (f.situacao) {
    // Em qualquer turno: quem foi ao 2º turno tem "2º TURNO" na linha do 1º e situação ainda vazia na do 2º.
    const s = SITUACOES[f.situacao];
    conds.push(`EXISTS (SELECT 1 FROM candidaturas x WHERE x.sq_candidato = c.sq_candidato AND x.situacao IN (${s.map(() => "?").join(", ")}))`);
    params.push(...s);
  }
  for (const [campo, valor] of [["genero", f.genero], ["cor_raca", f.cor_raca], ["ocupacao", f.ocupacao]] as const) {
    if (valor) {
      conds.push(`c.${campo} LIKE ?`);
      params.push(campo === "ocupacao" ? `%${valor}%` : valor.replace(/indigena/i, "INDÍGENA"));
    }
  }
  if (f.apenas_aptos) conds.push("c.situacao_candidatura IN ('DEFERIDO', 'DEFERIDO COM RECURSO', 'APTO')");
  return { sql: conds.join(" AND "), params };
}

/** Situação no último turno; no 2º turno ainda não apurado, o TSE deixa vazio. */
const situacao = (c: Record<string, unknown>) =>
  c.situacao ?? (Number(c.turno) === 2 ? "Disputa o 2º turno (resultado ainda não totalizado)" : c.situacao_candidatura);

const resumo = (c: Record<string, unknown>) => ({
  candidato: c.nome_urna,
  nome_completo: c.nome,
  numero: c.numero,
  cargo: c.ds_cargo,
  uf: c.uf,
  partido: c.partido,
  situacao: situacao(c),
});

export function registrarCandidatos(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "buscar_candidatos",
    {
      title: "Buscar candidatos",
      description:
        "Lista ou conta candidatos por nome, número, cargo, UF, partido, situação (eleito, 2º turno…), gênero, cor/raça e ocupação. " +
        'Com agrupar_por, responde perguntas como "quantas mulheres foram eleitas deputadas federais em SP?" ou ' +
        '"qual partido elegeu mais deputados?". Bases pequenas, baixadas automaticamente.',
      inputSchema: {
        ...filtrosSchema,
        agrupar_por: z.enum(["partido", "uf", "cargo", "genero", "cor_raca", "grau_instrucao", "ocupacao", "situacao", "estado_civil"]).optional(),
        limite: z.number().int().min(1).max(100).optional().describe("Padrão 20."),
        pagina: z.number().int().min(1).optional(),
      },
    },
    comTratamento(async (args) => {
      const ano = (await ctx.bases.resolver("candidatos", { ano: args.ano })).ano;
      const b = await ctx.bases.obter<BancoCandidatos>("candidatos", { ano });
      const w = whereCandidaturas(b.db, args);
      const total = (b.db.prepare(`SELECT COUNT(*) n FROM candidaturas c WHERE ${w.sql}`).get(...w.params) as { n: number }).n;
      const limite = args.limite ?? 20;
      if (args.agrupar_por) {
        const campo = args.agrupar_por === "cargo" ? "ds_cargo" : args.agrupar_por;
        const grupos = b.db
          .prepare(`SELECT COALESCE(c.${campo}, 'Não informado') chave, COUNT(*) n FROM candidaturas c WHERE ${w.sql} GROUP BY chave ORDER BY n DESC LIMIT ?`)
          .all(...w.params, limite) as { chave: string; n: number }[];
        return respostaJson({ total, grupos: grupos.map((g) => ({ [args.agrupar_por!]: g.chave, candidatos: g.n, percentual: pct(g.n, total) })), fonte: FONTE(ano) });
      }
      const pagina = args.pagina ?? 1;
      const linhas = b.db
        .prepare(`SELECT * FROM candidaturas c WHERE ${w.sql} ORDER BY c.uf, c.cd_cargo, c.nome_urna LIMIT ? OFFSET ?`)
        .all(...w.params, limite, (pagina - 1) * limite) as Record<string, unknown>[];
      return respostaJson({ total, pagina, candidatos: linhas.map(resumo), fonte: FONTE(ano) });
    }),
  );

  server.registerTool(
    "perfil_candidato",
    {
      title: "Perfil de candidato",
      description:
        "Ficha completa de um candidato: cargo, número, partido, federação/coligação, situação, idade, gênero, cor/raça, " +
        "instrução, ocupação, naturalidade, se tenta reeleição, teto de gastos e bens declarados (total e maiores itens). " +
        "Se o nome casar com vários candidatos, devolve a lista para o usuário escolher.",
      inputSchema: {
        nome: z.string().optional(),
        numero: z.number().int().optional(),
        cargo: z.string().optional(),
        uf: z.string().optional(),
        ano: z.number().int().optional(),
        max_bens: z.number().int().min(0).max(200).optional().describe("Quantos bens listar (padrão 10, maiores primeiro)."),
      },
    },
    comTratamento(async (args) => {
      if (!args.nome && args.numero === undefined) throw new Error("Informe `nome` ou `numero`.");
      const ano = (await ctx.bases.resolver("candidatos", { ano: args.ano })).ano;
      const b = await ctx.bases.obter<BancoCandidatos>("candidatos", { ano });
      const w = whereCandidaturas(b.db, args);
      const achados = b.db.prepare(`SELECT * FROM candidaturas c WHERE ${w.sql} LIMIT 30`).all(...w.params) as Record<string, unknown>[];
      if (!achados.length) throw new Error("Nenhum candidato encontrado.");
      if (achados.length > 1) {
        return respostaJson({
          mensagem: "Vários candidatos correspondem. Pergunte ao usuário qual é e refaça com `numero`, `cargo` e `uf`.",
          candidatos: achados.map(resumo),
        });
      }
      const c = achados[0];
      const sq = Number(c.sq_candidato);
      const [comp, bens] = await Promise.all([
        ctx.bases.obter<BancoCandidatos>("candidatos-complementar", { ano }),
        ctx.bases.obter<BancoCandidatos>("bens-candidatos", { ano }),
      ]);
      const extra = (comp.db.prepare("SELECT * FROM complementar WHERE sq_candidato = ?").get(sq) ?? {}) as Record<string, unknown>;
      const totalBens = bens.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) total FROM bens WHERE sq_candidato = ?").get(sq) as { n: number; total: number };
      const itens = bens.db
        .prepare("SELECT tipo, descricao, valor FROM bens WHERE sq_candidato = ? ORDER BY valor DESC LIMIT ?")
        .all(sq, args.max_bens ?? 10) as { tipo: string; descricao: string; valor: number }[];
      return respostaJson({
        ...resumo(c),
        nome_social: c.nome_social ?? undefined,
        situacao_candidatura: c.situacao_candidatura ?? undefined,
        local_disputa: c.nm_ue,
        federacao: c.federacao ?? undefined,
        coligacao: c.coligacao ?? undefined,
        composicao_coligacao: c.composicao ?? undefined,
        idade_na_posse: extra.idade_posse ?? undefined,
        genero: c.genero,
        cor_raca: c.cor_raca,
        grau_instrucao: c.grau_instrucao,
        estado_civil: c.estado_civil,
        ocupacao: c.ocupacao,
        naturalidade: [extra.municipio_nascimento, c.uf_nascimento].filter(Boolean).join("/") || undefined,
        nacionalidade: extra.nacionalidade ?? undefined,
        candidato_a_reeleicao: extra.reeleicao === "S" ? true : extra.reeleicao === "N" ? false : undefined,
        quilombola: extra.quilombola === "S" ? true : undefined,
        etnia_indigena: extra.etnia_indigena && extra.etnia_indigena !== "NÃO INFORMADA" ? extra.etnia_indigena : undefined,
        teto_gastos_campanha: extra.despesa_max_campanha ?? undefined,
        situacao_julgamento: extra.situacao_julgamento ?? undefined,
        situacao_cassacao: extra.situacao_cassacao ?? undefined,
        bens_declarados: { quantidade: totalBens.n, valor_total: Math.round(totalBens.total * 100) / 100, maiores: itens },
        dica: "Para a votação, use `votos_candidato` com o mesmo número, cargo e UF.",
        fonte: FONTE(ano),
      });
    }),
  );

  server.registerTool(
    "ranking_patrimonio",
    {
      title: "Ranking de patrimônio declarado",
      description:
        'Candidatos com maior (ou menor) patrimônio declarado, por cargo, UF, partido ou situação. Ex.: "quem são os ' +
        'candidatos a governador mais ricos?", "patrimônio médio dos deputados eleitos por partido" (agrupar_por="partido").',
      inputSchema: {
        ...filtrosSchema,
        agrupar_por: z.enum(["partido", "uf", "cargo", "genero", "cor_raca"]).optional().describe("Mostra total, média e mediana por grupo."),
        ordem: z.enum(["desc", "asc"]).optional(),
        limite: z.number().int().min(1).max(100).optional().describe("Padrão 10."),
      },
    },
    comTratamento(async (args) => {
      const ano = (await ctx.bases.resolver("candidatos", { ano: args.ano })).ano;
      const [b, bens] = await Promise.all([
        ctx.bases.obter<BancoCandidatos>("candidatos", { ano }),
        ctx.bases.obter<BancoCandidatos>("bens-candidatos", { ano }),
      ]);
      const w = whereCandidaturas(b.db, args);
      const candidatos = b.db.prepare(`SELECT * FROM candidaturas c WHERE ${w.sql}`).all(...w.params) as Record<string, unknown>[];
      const totais = new Map(
        (bens.db.prepare("SELECT sq_candidato, SUM(valor) total FROM bens GROUP BY sq_candidato").all() as { sq_candidato: number; total: number }[]).map((r) => [r.sq_candidato, r.total]),
      );
      const comValor = candidatos.map((c) => ({ c, total: totais.get(Number(c.sq_candidato)) ?? 0 }));
      const desc = args.ordem !== "asc";
      if (args.agrupar_por) {
        const campo = args.agrupar_por === "cargo" ? "ds_cargo" : args.agrupar_por;
        const grupos = new Map<string, number[]>();
        for (const { c, total } of comValor) {
          const k = String(c[campo] ?? "Não informado");
          (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(total);
        }
        const linhas = [...grupos.entries()].map(([chave, vs]) => {
          const ord = [...vs].sort((a, b) => a - b);
          const soma = vs.reduce((s, v) => s + v, 0);
          return { [args.agrupar_por!]: chave, candidatos: vs.length, patrimonio_total: Math.round(soma), media: Math.round(soma / vs.length), mediana: Math.round(ord[Math.floor(ord.length / 2)]) };
        });
        linhas.sort((a, b) => (desc ? b.media - a.media : a.media - b.media));
        return respostaJson({ candidatos: comValor.length, grupos: linhas.slice(0, args.limite ?? 10), fonte: FONTE(ano) });
      }
      comValor.sort((a, b) => (desc ? b.total - a.total : a.total - b.total));
      return respostaJson({
        candidatos: comValor.length,
        ranking: comValor.slice(0, args.limite ?? 10).map(({ c, total }) => ({ ...resumo(c), patrimonio_declarado: Math.round(total * 100) / 100 })),
        aviso: "Valores declarados pelo próprio candidato no registro, sem atualização de mercado.",
        fonte: FONTE(ano),
      });
    }),
  );

  server.registerTool(
    "vagas_e_coligacoes",
    {
      title: "Vagas e coligações",
      description:
        'Quantas vagas há para um cargo numa UF e quais partidos, federações e coligações disputam. Ex.: "quantas vagas ' +
        'de deputado federal tem SP?", "quais partidos formam a coligação do candidato X ao governo do DF?".',
      inputSchema: {
        cargo: z.string().describe('Ex.: "deputado federal".'),
        uf: z.string().describe('UF (sigla/nome) ou "BR" para presidente.'),
        ano: z.number().int().optional(),
      },
    },
    comTratamento(async (args) => {
      const ano = (await ctx.bases.resolver("vagas", { ano: args.ano })).ano;
      const [vg, col] = await Promise.all([ctx.bases.obter<BancoCandidatos>("vagas", { ano }), ctx.bases.obter<BancoCandidatos>("coligacoes", { ano })]);
      const uf = /^(BR|BRASIL)$/i.test(args.uf.trim()) ? "BR" : resolverUf(args.uf);
      if (!uf) throw new Error(`UF desconhecida: "${args.uf}".`);
      const cargo = resolverCargo(cargosDisponiveis(vg.db, "vagas"), args.cargo, uf);
      const vaga = vg.db.prepare("SELECT vagas, posse, nm_ue FROM vagas WHERE cd_cargo = ? AND uf = ?").get(cargo.cd, uf) as { vagas: number; posse: string; nm_ue: string } | undefined;
      const linhas = col.db
        .prepare("SELECT DISTINCT tipo, partido, nr_partido, federacao, coligacao, composicao, situacao FROM coligacoes WHERE cd_cargo = ? AND uf = ? ORDER BY coligacao, partido")
        .all(cargo.cd, uf) as Record<string, string | number | null>[];
      const porAgremiacao = new Map<string, { nome: string; tipo: unknown; composicao: unknown; partidos: string[] }>();
      for (const l of linhas) {
        const nome = String(l.coligacao ?? l.federacao ?? l.partido);
        const g = porAgremiacao.get(nome) ?? { nome, tipo: l.tipo, composicao: l.composicao, partidos: [] };
        g.partidos.push(String(l.partido));
        porAgremiacao.set(nome, g);
      }
      return respostaJson({
        cargo: cargo.ds,
        local: vaga?.nm_ue ?? uf,
        vagas: vaga?.vagas ?? null,
        data_posse: vaga?.posse,
        agremiacoes: [...porAgremiacao.values()],
        fonte: FONTE(ano),
      });
    }),
  );
}
