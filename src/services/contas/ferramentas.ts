import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { normalizar } from "../../lib/texto.js";
import { resolverUf } from "../locais-votacao/localidades.js";
import type { BancoCandidatos } from "../candidatos/bases.js";
import { cargosDisponiveis, pct, resolverCargo } from "../resultados/filtros.js";
import type { BancoContas } from "./bases.js";

const reais = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

const FONTE = (ano?: number) => ({
  descricao: `TSE - Portal de Dados Abertos, Prestação de Contas Eleitorais ${ano ?? ""}`.trim(),
  url: `https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-${ano}`,
  aviso: "Dados declarados pelas campanhas e atualizados ao longo da prestação de contas; podem mudar até a entrega final.",
});

/** Origem "amigável": combina a fonte (fundos públicos) com a origem declarada. */
const ORIGEM_SQL = `CASE
  WHEN fonte = 'FUNDO ESPECIAL' THEN 'Fundo Especial de Financiamento de Campanha (FEFC)'
  WHEN fonte = 'FUNDO PARTIDARIO' THEN 'Fundo Partidário'
  ELSE COALESCE(origem, 'Não informada') END`;

function whereContas(
  db: BancoContas["db"],
  a: { cargo?: string; uf?: string; partido?: string; nome?: string; numero?: number },
  prefixo = "",
) {
  const conds: string[] = [];
  const params: SQLInputValue[] = [];
  let uf: string | undefined;
  if (a.uf) {
    uf = /^(BR|BRASIL)$/i.test(a.uf.trim()) ? "BR" : resolverUf(a.uf);
    if (!uf) throw new Error(`UF desconhecida: "${a.uf}".`);
    conds.push(`${prefixo}uf = ?`);
    params.push(uf);
  }
  if (a.cargo) {
    const c = resolverCargo(cargosDisponiveis(db, "receitas"), a.cargo, uf);
    conds.push(`${prefixo}cd_cargo = ?`);
    params.push(c.cd);
  }
  if (a.partido) {
    conds.push(`UPPER(REPLACE(${prefixo}partido, ' ', '')) = ?`);
    params.push(a.partido.toUpperCase().replace(/\s/g, ""));
  }
  if (a.nome) {
    conds.push(`${prefixo}candidato_norm LIKE ?`);
    params.push(`%${normalizar(a.nome)}%`);
  }
  if (a.numero !== undefined) {
    conds.push(`${prefixo}numero = ?`);
    params.push(a.numero);
  }
  return { sql: conds.length ? conds.join(" AND ") : "1 = 1", params };
}

export function registrarContas(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "financas_candidato",
    {
      title: "Finanças de campanha de um candidato",
      description:
        "Quanto um candidato arrecadou e gastou: receitas por origem (Fundo Eleitoral/FEFC, Fundo Partidário, pessoas físicas, " +
        "recursos próprios…), maiores doadores, despesas por categoria, maiores fornecedores e uso do teto de gastos. " +
        'Ex.: "quanto a campanha de fulano recebeu do fundo eleitoral?", "com o que fulana mais gastou?".',
      inputSchema: {
        nome: z.string().optional().describe("Nome completo ou parte (como no registro de candidatura)."),
        numero: z.number().int().optional(),
        cargo: z.string().optional(),
        uf: z.string().optional().describe('UF da candidatura; "BR" para presidente.'),
        ano: z.number().int().optional(),
        limite: z.number().int().min(1).max(50).optional().describe("Itens em cada lista (padrão 10)."),
      },
    },
    comTratamento(async (args) => {
      if (!args.nome && args.numero === undefined) throw new Error("Informe `nome` ou `numero`.");
      const ano = (await ctx.bases.resolver("prestacao-contas", { ano: args.ano })).ano;
      const b = await ctx.bases.obter<BancoContas>("prestacao-contas", { ano });
      const w = whereContas(b.db, args);
      const achados = b.db
        .prepare(
          `SELECT sq_candidato, candidato, numero, ds_cargo, uf, partido FROM receitas WHERE ${w.sql} GROUP BY sq_candidato
           UNION SELECT sq_candidato, candidato, numero, ds_cargo, uf, partido FROM despesas WHERE ${w.sql} GROUP BY sq_candidato LIMIT 30`,
        )
        .all(...w.params, ...w.params) as { sq_candidato: number; candidato: string; numero: number; ds_cargo: string; uf: string; partido: string }[];
      const unicos = [...new Map(achados.map((a) => [a.sq_candidato, a])).values()];
      if (!unicos.length) throw new Error("Nenhuma prestação de contas encontrada para esse candidato (ele pode não ter declarado movimentação ainda).");
      if (unicos.length > 1) {
        return respostaJson({ mensagem: "Vários candidatos correspondem. Pergunte qual é e refaça com `numero`, `cargo` e `uf`.", candidatos: unicos });
      }
      const k = unicos[0];
      const sq = k.sq_candidato;
      const limite = args.limite ?? 10;
      const rec = b.db.prepare("SELECT COUNT(*) n, SUM(valor) total, SUM(CASE WHEN natureza = 'ESTIMÁVEL' THEN valor ELSE 0 END) estimavel FROM receitas WHERE sq_candidato = ?").get(sq) as Record<string, number>;
      const porOrigem = b.db.prepare(`SELECT ${ORIGEM_SQL} origem, SUM(valor) total FROM receitas WHERE sq_candidato = ? GROUP BY 1 ORDER BY total DESC`).all(sq) as { origem: string; total: number }[];
      const doadores = b.db
        .prepare("SELECT doador, tipo_doador, partido_doador, SUM(valor) total FROM receitas WHERE sq_candidato = ? GROUP BY doador ORDER BY total DESC LIMIT ?")
        .all(sq, limite) as Record<string, unknown>[];
      const desp = b.db.prepare("SELECT COUNT(*) n, SUM(valor) total FROM despesas WHERE sq_candidato = ?").get(sq) as Record<string, number>;
      const porCategoria = b.db.prepare("SELECT COALESCE(categoria, 'Não informada') categoria, SUM(valor) total FROM despesas WHERE sq_candidato = ? GROUP BY 1 ORDER BY total DESC LIMIT ?").all(sq, limite) as { categoria: string; total: number }[];
      const fornecedores = b.db
        .prepare("SELECT fornecedor, tipo_fornecedor, cnpj_fornecedor, MAX(atividade_fornecedor) atividade, SUM(valor) total FROM despesas WHERE sq_candidato = ? GROUP BY fornecedor ORDER BY total DESC LIMIT ?")
        .all(sq, limite) as Record<string, unknown>[];

      // Teto de gastos (base complementar de candidatos, pequena e baixada automaticamente).
      let teto: number | null = null;
      try {
        const comp = await ctx.bases.obter<BancoCandidatos>("candidatos-complementar", { ano });
        teto = (comp.db.prepare("SELECT despesa_max_campanha t FROM complementar WHERE sq_candidato = ?").get(sq) as { t: number } | undefined)?.t ?? null;
      } catch {
        // Sem a base complementar, segue sem o teto.
      }
      const totalRec = Number(rec.total ?? 0);
      const totalDesp = Number(desp.total ?? 0);
      return respostaJson({
        candidato: k.candidato,
        numero: k.numero,
        cargo: k.ds_cargo,
        uf: k.uf,
        partido: k.partido,
        receitas: {
          total: reais(totalRec),
          lancamentos: rec.n,
          estimaveis: reais(rec.estimavel),
          por_origem: porOrigem.map((o) => ({ origem: o.origem, total: reais(o.total), percentual: pct(o.total, totalRec) })),
          maiores_doadores: doadores.map((d) => ({ doador: d.doador, tipo: d.tipo_doador === "PF" ? "pessoa física" : d.tipo_doador === "PJ" ? "pessoa jurídica" : undefined, partido: d.partido_doador ?? undefined, total: reais(d.total) })),
        },
        despesas_contratadas: {
          total: reais(totalDesp),
          lancamentos: desp.n,
          por_categoria: porCategoria.map((c) => ({ categoria: c.categoria, total: reais(c.total), percentual: pct(c.total, totalDesp) })),
          maiores_fornecedores: fornecedores.map((f) => ({ fornecedor: f.fornecedor, cnpj: f.cnpj_fornecedor ?? undefined, atividade: f.atividade ?? undefined, total: reais(f.total) })),
        },
        teto_de_gastos: teto ?? undefined,
        uso_do_teto_pct: teto ? pct(totalDesp, teto) : undefined,
        fonte: FONTE(ano),
      });
    }),
  );

  server.registerTool(
    "ranking_financas",
    {
      title: "Ranking de arrecadação e gastos",
      description:
        'Rankings de receitas ou despesas de campanha. Ex.: "quem mais arrecadou para deputado federal em SP?", ' +
        '"quanto cada partido recebeu do Fundo Eleitoral?" (tipo=receitas, origem="fundo especial", agrupar_por="partido"), ' +
        '"maiores fornecedores das campanhas a governador" (tipo=despesas, agrupar_por="fornecedor"), ' +
        '"quais campanhas contrataram a empresa X?" (tipo=despesas, fornecedor="X").',
      inputSchema: {
        tipo: z.enum(["receitas", "despesas"]),
        cargo: z.string().optional(),
        uf: z.string().optional(),
        partido: z.string().optional(),
        origem: z.string().optional().describe('Receitas: "fundo especial" (FEFC), "fundo partidário", "pessoas físicas", "recursos próprios"…'),
        categoria: z.string().optional().describe('Despesas: trecho da categoria, ex.: "impulsionamento", "advocatícios".'),
        fornecedor: z.string().optional().describe("Despesas: trecho do nome ou CNPJ do fornecedor."),
        agrupar_por: z.enum(["candidato", "partido", "uf", "cargo", "origem", "categoria", "fornecedor"]).optional().describe('Padrão: "candidato".'),
        ano: z.number().int().optional(),
        limite: z.number().int().min(1).max(100).optional().describe("Padrão 10."),
      },
    },
    comTratamento(async (args) => {
      const ano = (await ctx.bases.resolver("prestacao-contas", { ano: args.ano })).ano;
      const b = await ctx.bases.obter<BancoContas>("prestacao-contas", { ano });
      const receitas = args.tipo === "receitas";
      const tabela = receitas ? "receitas" : "despesas";
      const w = whereContas(b.db, args);
      const conds = [w.sql];
      const params = [...w.params];
      if (args.origem) {
        if (!receitas) throw new Error("`origem` vale só para receitas; para despesas use `categoria`.");
        conds.push(`${ORIGEM_SQL} LIKE ?`);
        params.push(`%${args.origem.replace(/partidario/i, "Partidário").replace(/fefc|fundo eleitoral/i, "Fundo Especial")}%`);
      }
      if (args.categoria) {
        conds.push("categoria LIKE ?");
        params.push(`%${args.categoria}%`);
      }
      if (args.fornecedor) {
        if (receitas) throw new Error("`fornecedor` vale só para despesas.");
        const doc = args.fornecedor.replace(/\D/g, "");
        if (doc.length === 14) {
          conds.push("cnpj_fornecedor = ?");
          params.push(doc);
        } else {
          conds.push("fornecedor_norm LIKE ?");
          params.push(`%${normalizar(args.fornecedor)}%`);
        }
      }
      const agrupar = args.agrupar_por ?? "candidato";
      if (agrupar === "origem" && !receitas) throw new Error('Para despesas, agrupe por "categoria".');
      if ((agrupar === "categoria" || agrupar === "fornecedor") && receitas) throw new Error(`"${agrupar}" vale só para despesas.`);
      const chave = {
        candidato: "sq_candidato",
        partido: "partido",
        uf: "uf",
        cargo: "cd_cargo",
        origem: ORIGEM_SQL,
        categoria: "categoria",
        fornecedor: "COALESCE(cnpj_fornecedor, fornecedor)",
      }[agrupar];
      const rotulo = {
        candidato: "MAX(candidato) || ' (' || MAX(partido) || ', ' || MAX(ds_cargo) || '/' || MAX(uf) || ')'",
        partido: "partido",
        uf: "uf",
        cargo: "MAX(ds_cargo)",
        origem: ORIGEM_SQL,
        categoria: "COALESCE(categoria, 'Não informada')",
        fornecedor: "MAX(fornecedor) || COALESCE(' — CNPJ ' || MAX(cnpj_fornecedor), '')",
      }[agrupar];
      const where = conds.join(" AND ");
      const total = (b.db.prepare(`SELECT SUM(valor) t, COUNT(DISTINCT sq_candidato) c FROM ${tabela} WHERE ${where}`).get(...params) as { t: number; c: number });
      const linhas = b.db
        .prepare(`SELECT ${rotulo} AS item, SUM(valor) total, COUNT(DISTINCT sq_candidato) candidatos FROM ${tabela} WHERE ${where} GROUP BY ${chave} ORDER BY total DESC LIMIT ?`)
        .all(...params, args.limite ?? 10) as { item: string; total: number; candidatos: number }[];
      return respostaJson({
        tipo: args.tipo,
        total: reais(total.t),
        candidatos: total.c,
        ranking: linhas.map((l) => ({ [agrupar]: l.item, total: reais(l.total), percentual: pct(l.total, total.t), ...(agrupar !== "candidato" ? { candidatos: l.candidatos } : {}) })),
        fonte: FONTE(ano),
      });
    }),
  );
}
