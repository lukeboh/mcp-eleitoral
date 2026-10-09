import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import type { FiltroLocais } from "./repositorio.js";
import type { LocalVotacao, MetadadosBase } from "./tipos.js";

const filtros = {
  uf: z
    .string()
    .optional()
    .describe('Sigla ou nome da UF (ex.: "DF", "São Paulo"). Use "exterior" (ou "ZZ") para locais fora do Brasil.'),
  municipio: z
    .string()
    .optional()
    .describe(
      'Município. No exterior é a cidade, grafada em português pelo TSE (ex.: "NOVA YORK", "TÓQUIO", "LONDRES"). ' +
        "Acentos e maiúsculas são ignorados. No DF todo o território é o município BRASÍLIA; use `bairro` para regiões administrativas.",
    ),
  zona: z.number().int().positive().optional().describe("Número da zona eleitoral."),
  secao: z.number().int().positive().optional().describe("Número da seção eleitoral (combine com `zona` e `uf`)."),
  bairro: z.string().optional().describe('Trecho do bairro (ex.: "ASA SUL", "TAGUATINGA").'),
  nome: z.string().optional().describe('Trecho do nome do local (ex.: "escola classe 206").'),
  escopo: z
    .enum(["todos", "brasil", "exterior"])
    .optional()
    .describe('"brasil" exclui o exterior; "exterior" só locais fora do país. Padrão: "todos".'),
  incluir_inativos: z.boolean().optional().describe("Inclui locais bloqueados/inativos. Padrão: false."),
};

type ArgsFiltro = {
  uf?: string;
  municipio?: string;
  zona?: number;
  secao?: number;
  bairro?: string;
  nome?: string;
  escopo?: "todos" | "brasil" | "exterior";
  incluir_inativos?: boolean;
  incluir_especiais?: boolean;
};

function paraFiltro(a: ArgsFiltro, incluirEspeciaisPadrao: boolean): FiltroLocais {
  return {
    uf: a.uf,
    municipio: a.municipio,
    zona: a.zona,
    secao: a.secao,
    bairro: a.bairro,
    nome: a.nome,
    escopo: a.escopo,
    incluirInativos: a.incluir_inativos,
    incluirEspeciais: a.incluir_especiais ?? incluirEspeciaisPadrao,
  };
}

function fonteDados(m: MetadadosBase) {
  return {
    descricao: `TSE - Portal de Dados Abertos, Eleitorado - Locais de votação ${m.ano}`,
    eleicao: m.dataEleicao,
    gerado_em: m.dataGeracao,
    url: m.fonte,
  };
}

function resumoLocal(l: LocalVotacao) {
  return {
    nome: l.nome,
    endereco: l.endereco,
    bairro: l.bairro,
    municipio: l.municipio,
    uf: l.uf,
    cep: l.cep,
    zona: l.zona,
    secoes: l.secoes,
    eleitores: l.eleitores,
    acessivel: l.acessivel,
    tipo: l.tipo,
    situacao: l.situacao,
    coordenadas: l.latitude !== null ? { latitude: l.latitude, longitude: l.longitude } : null,
  };
}

export function registrarLocaisVotacao(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "contar_locais_votacao",
    {
      title: "Contar locais de votação",
      description:
        "Conta locais de votação, seções e eleitores no Brasil, numa UF, num município, no exterior ou numa cidade do exterior. " +
        'Ex.: "quantos locais de votação há no Brasil?" (escopo=brasil), "no DF?" (uf=DF), "no exterior?" (uf=exterior), ' +
        '"em Nova York?" (uf=exterior, municipio="NOVA YORK"). Use `agrupar_por` para rankings/quebras. ' +
        "Por padrão conta todos os locais ativos, inclusive especiais (ex.: unidades prisionais), como nas estatísticas oficiais.",
      inputSchema: {
        ...filtros,
        incluir_especiais: z
          .boolean()
          .optional()
          .describe('Inclui locais especiais como "Preso provisório". Padrão: true.'),
        agrupar_por: z
          .enum(["uf", "municipio", "zona", "bairro", "tipo"])
          .optional()
          .describe("Quebra o total por esse campo (top 50, do maior para o menor)."),
      },
    },
    comTratamento(async (args) => {
      const repo = await ctx.locais.obter();
      const c = repo.contar(paraFiltro(args, true), args.agrupar_por);
      return respostaJson({
        total_locais: c.locais,
        total_secoes: c.secoes,
        total_eleitores: c.eleitores,
        municipios_considerados: args.municipio ? c.municipios : undefined,
        grupos: c.grupos,
        avisos: c.avisos.length ? c.avisos : undefined,
        fonte: fonteDados(repo.metadados),
      });
    }),
  );

  server.registerTool(
    "buscar_locais_votacao",
    {
      title: "Buscar locais de votação",
      description:
        "Lista locais de votação (nome, endereço, zona, seções, acessibilidade) filtrando por UF, município, bairro, zona, seção ou nome. " +
        'Útil para "onde fica a seção 579 da zona 1 do DF?" ou "quais locais de votação há em Boston?".',
      inputSchema: {
        ...filtros,
        incluir_especiais: z
          .boolean()
          .optional()
          .describe('Inclui locais especiais como "Preso provisório". Padrão: false.'),
        limite: z.number().int().min(1).max(100).optional().describe("Máximo de resultados (padrão 20)."),
        pagina: z.number().int().min(1).optional().describe("Página de resultados (padrão 1)."),
      },
    },
    comTratamento(async (args) => {
      const repo = await ctx.locais.obter();
      const { locais, municipios, avisos } = repo.filtrar(paraFiltro(args, false));
      const limite = args.limite ?? 20;
      const pagina = args.pagina ?? 1;
      return respostaJson({
        total: locais.length,
        pagina,
        locais: locais.slice((pagina - 1) * limite, pagina * limite).map(resumoLocal),
        municipios_considerados: args.municipio ? municipios.slice(0, 20) : undefined,
        avisos: avisos.length ? avisos : undefined,
        fonte: fonteDados(repo.metadados),
      });
    }),
  );

  server.registerTool(
    "locais_votacao_proximos",
    {
      title: "Locais de votação mais próximos",
      description:
        "Encontra os locais de votação mais próximos de um ponto, por distância em linha reta. " +
        "Informe `endereco` (rua, número, cidade ou CEP) ou `latitude`/`longitude`. " +
        'Este servidor não sabe onde o usuário está: para "perto daqui" ou "perto da casa do meu pai", peça o endereço ou CEP. ' +
        "Atenção: o local mais próximo não é necessariamente onde a pessoa vota — isso depende da zona/seção do título. " +
        "Locais do exterior não têm coordenadas na base do TSE.",
      inputSchema: {
        endereco: z.string().optional().describe('Endereço ou CEP (ex.: "SQS 206, Brasília - DF" ou "70252-040").'),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        limite: z.number().int().min(1).max(50).optional().describe("Quantos locais retornar (padrão 5)."),
        raio_km: z.number().positive().optional().describe("Distância máxima em km."),
        ...filtros,
        incluir_especiais: z
          .boolean()
          .optional()
          .describe('Inclui locais especiais como "Preso provisório". Padrão: false.'),
      },
    },
    comTratamento(async (args) => {
      let ponto: { latitude: number; longitude: number };
      let origem: Record<string, unknown>;
      if (args.latitude !== undefined && args.longitude !== undefined) {
        ponto = { latitude: args.latitude, longitude: args.longitude };
        origem = { tipo: "coordenadas", ...ponto };
      } else if (args.endereco) {
        const geo = await ctx.geocodificador.geocodificar(args.endereco);
        if (!geo) throw new Error(`Não foi possível localizar o endereço "${args.endereco}". Tente incluir cidade e UF, ou o CEP.`);
        ponto = { latitude: geo.latitude, longitude: geo.longitude };
        origem = { tipo: "endereco", informado: args.endereco, encontrado: geo.enderecoEncontrado, ...ponto, fonte: geo.fonte };
      } else {
        throw new Error("Informe `endereco` (ou CEP) ou `latitude` e `longitude`.");
      }

      const repo = await ctx.locais.obter();
      const r = repo.maisProximos(ponto, {
        filtro: paraFiltro(args, false),
        limite: args.limite,
        raioKm: args.raio_km,
      });
      return respostaJson({
        origem,
        locais: r.locais.map((l) => ({ distancia_km: Math.round(l.distanciaKm * 100) / 100, ...resumoLocal(l) })),
        avisos: [
          ...r.avisos,
          "Distância em linha reta. O local onde a pessoa vota é definido pela zona/seção do título, não pela proximidade.",
        ],
        fonte: fonteDados(repo.metadados),
      });
    }),
  );
}
