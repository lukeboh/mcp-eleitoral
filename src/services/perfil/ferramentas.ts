import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { descreverRegiao, pct, resolverRegiao, whereRegiao } from "../resultados/filtros.js";
import { ESPEC_COMPARECIMENTO, ESPEC_ELEITORADO } from "./bases.js";
import { CAMPOS_AGRUPAR, codigosFiltro, consultarCubo, type BancoCubo, type FiltrosDimensao } from "./cubo.js";

const filtrosSchema = {
  uf: z.string().optional().describe('UF (sigla/nome) ou "exterior".'),
  municipio: z.string().optional(),
  zona: z.number().int().positive().optional().describe("Zona eleitoral (combine com `uf`)."),
  genero: z.string().optional().describe('"feminino" ou "masculino".'),
  idade_min: z.number().int().min(16).optional().describe("Idade mínima (as faixas do TSE: 16, 17, 18, 19, 20, 21–24, 25–29, …)."),
  idade_max: z.number().int().optional().describe("Idade máxima."),
  grau_instrucao: z.string().optional().describe('Ex.: "analfabeto", "superior completo", "ensino médio".'),
  cor_raca: z.string().optional().describe('Ex.: "preta", "parda", "indígena".'),
  estado_civil: z.string().optional(),
  identidade_genero: z.string().optional().describe('Ex.: "transgênero".'),
  quilombola: z.string().optional().describe('"sim" ou "não".'),
  interprete_libras: z.string().optional().describe('"sim" ou "não".'),
  agrupar_por: z.enum(CAMPOS_AGRUPAR).optional().describe("Quebra o total por essa dimensão ou por uf/município/zona."),
  limite: z.number().int().min(1).max(200).optional().describe("Máximo de grupos (padrão 30)."),
};

type Args = FiltrosDimensao & { uf?: string; municipio?: string; zona?: number; agrupar_por?: (typeof CAMPOS_AGRUPAR)[number]; limite?: number };

function filtrosDescritos(a: Args) {
  const f: Record<string, unknown> = {};
  for (const k of ["genero", "grau_instrucao", "cor_raca", "estado_civil", "identidade_genero", "quilombola", "interprete_libras"] as const) if (a[k]) f[k] = a[k];
  if (a.idade_min !== undefined || a.idade_max !== undefined) f.idade = `${a.idade_min ?? 16}–${a.idade_max ?? "∞"}`;
  return Object.keys(f).length ? f : undefined;
}

export function registrarPerfil(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "perfil_eleitorado",
    {
      title: "Perfil do eleitorado",
      description:
        "Quantos eleitores e com que perfil (gênero, idade, instrução, cor/raça, estado civil, identidade de gênero, quilombola, " +
        'Libras), no Brasil, UF, município ou zona. Ex.: "quantos eleitores de 16 e 17 anos há no DF?" (idade_max=17), ' +
        '"perfil de escolaridade de Campinas" (agrupar_por="grau_instrucao"), "quantas mulheres com ensino superior em SP?". ' +
        "Inclui biometria, eleitores com deficiência e com nome social. Retrato atual do cadastro.",
      inputSchema: filtrosSchema,
    },
    comTratamento(async (args: Args) => {
      const b = await ctx.bases.obter<BancoCubo>("perfil-eleitorado");
      const avisos: string[] = [];
      const regiao = resolverRegiao(b.db, args, avisos, "municipios");
      const r = consultarCubo(b, ESPEC_ELEITORADO, {
        where: whereRegiao(regiao),
        filtros: codigosFiltro(b.db, args),
        agrupar: args.agrupar_por,
        medidas: ESPEC_ELEITORADO.medidas.map((m) => m.nome),
        limite: args.limite ?? 30,
        ordenarPor: "eleitores",
      });
      const total = Number(r.total.eleitores ?? 0);
      return respostaJson({
        regiao: descreverRegiao(regiao),
        filtros: filtrosDescritos(args),
        eleitores: total,
        com_biometria_pct: pct(Number(r.total.biometria ?? 0), total),
        com_deficiencia: r.total.deficiencia,
        com_nome_social: r.total.nome_social,
        grupos: r.grupos?.map((g) => ({ [args.agrupar_por!]: g.grupo, eleitores: g.eleitores, percentual: pct(Number(g.eleitores), total) })),
        avisos: avisos.length ? avisos : undefined,
        fonte: {
          descricao: "TSE - Portal de Dados Abertos, Eleitorado Atual (perfil do eleitorado)",
          gerado_em: b.extras.dataGeracao,
          url: "https://dadosabertos.tse.jus.br/dataset/eleitorado-atual",
        },
      });
    }),
  );

  server.registerTool(
    "perfil_comparecimento",
    {
      title: "Comparecimento e abstenção por perfil",
      description:
        "Comparecimento e abstenção por gênero, faixa etária, instrução, cor/raça etc., por UF, município ou zona e turno. " +
        'Ex.: "os jovens votaram mais ou menos que os idosos?" (agrupar_por="faixa_etaria"), "abstenção das mulheres em SP", ' +
        '"compare a abstenção por escolaridade em 2022 e 2024" (duas chamadas com `ano`). O TSE publica esse perfil alguns meses ' +
        "depois da eleição; para os totais da eleição mais recente use `comparecimento_abstencao`.",
      inputSchema: {
        ...filtrosSchema,
        ano: z.number().int().optional().describe("Ano da eleição. Padrão: a mais recente com perfil publicado."),
        turno: z.number().int().min(1).max(2).optional().describe("Padrão: 1."),
      },
    },
    comTratamento(async (args: Args & { ano?: number; turno?: number }) => {
      const b = await ctx.bases.obter<BancoCubo>("perfil-comparecimento", { ano: args.ano });
      const ano = (await ctx.bases.resolver("perfil-comparecimento", { ano: args.ano })).ano;
      const avisos: string[] = [];
      const regiao = resolverRegiao(b.db, args, avisos, "municipios");
      const r = consultarCubo(b, ESPEC_COMPARECIMENTO, {
        where: whereRegiao(regiao),
        turno: args.turno ?? 1,
        filtros: codigosFiltro(b.db, args),
        agrupar: args.agrupar_por,
        medidas: ESPEC_COMPARECIMENTO.medidas.map((m) => m.nome),
        limite: args.limite ?? 30,
        ordenarPor: "aptos",
      });
      const linha = (t: Record<string, unknown>) => ({
        aptos: t.aptos,
        comparecimento: t.comparecimento,
        comparecimento_pct: pct(Number(t.comparecimento), Number(t.aptos)),
        abstencao: t.abstencao,
        abstencao_pct: pct(Number(t.abstencao), Number(t.aptos)),
      });
      if (!Number(r.total.aptos)) avisos.push("Nenhum eleitor apto com esses filtros (no 2º turno só há dados onde houve 2º turno).");
      return respostaJson({
        ano,
        turno: args.turno ?? 1,
        regiao: descreverRegiao(regiao),
        filtros: filtrosDescritos(args),
        ...linha(r.total),
        pessoas_com_deficiencia: {
          comparecimento: r.total.comparecimento_deficiencia,
          abstencao: r.total.abstencao_deficiencia,
          abstencao_pct: pct(Number(r.total.abstencao_deficiencia), Number(r.total.comparecimento_deficiencia) + Number(r.total.abstencao_deficiencia)),
        },
        grupos: r.grupos?.map((g) => ({ [args.agrupar_por!]: g.grupo, ...linha(g) })),
        avisos: avisos.length ? avisos : undefined,
        fonte: {
          descricao: `TSE - Portal de Dados Abertos, Comparecimento e Abstenção ${ano}`,
          url: `https://dadosabertos.tse.jus.br/dataset/comparecimento-e-abstencao-${ano}`,
        },
      });
    }),
  );
}
