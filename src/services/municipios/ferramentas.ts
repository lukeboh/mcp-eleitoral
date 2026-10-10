import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { resolverUf } from "../locais-votacao/localidades.js";
import type { Municipio, TabelaMunicipios } from "./tabela.js";

const FONTE = {
  descricao: "TSE - Portal de Dados Abertos, Códigos oficiais de UF e municípios segundo o TSE e o IBGE",
  url: "https://dadosabertos.tse.jus.br/dataset/codigos-oficiais-de-uf-e-municipios-segundo-o-tse-e-o-ibge",
};

const formatar = (m: Municipio) => ({
  nome: m.nome,
  uf: m.uf,
  nome_uf: m.nomeUf,
  codigo_tse: m.codigoTse,
  codigo_ibge: m.codigoIbge,
  capital: m.capital,
});

export function registrarMunicipios(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "buscar_municipio",
    {
      title: "Buscar município (códigos TSE e IBGE)",
      description:
        "Encontra municípios brasileiros por nome (ignora acentos e tolera erros de digitação) ou por código, " +
        "devolvendo UF, código do TSE, código do IBGE e se é capital. Útil para desambiguar homônimos " +
        '(ex.: "Santa Maria" existe no RS e no RN) e para cruzar dados eleitorais com dados do IBGE.',
      inputSchema: {
        nome: z.string().optional().describe('Nome do município (ex.: "sao jose dos campos").'),
        uf: z.string().optional().describe("Sigla ou nome da UF para restringir a busca."),
        codigo_tse: z.string().optional().describe("Código do município no TSE (5 dígitos)."),
        codigo_ibge: z.number().int().optional().describe("Código do município no IBGE (7 dígitos)."),
        capitais: z.boolean().optional().describe("Lista as 27 capitais (ignora os demais filtros)."),
      },
    },
    comTratamento(async (args) => {
      const tabela = await ctx.bases.obter<TabelaMunicipios>("municipios");
      if (args.capitais) {
        return respostaJson({ municipios: tabela.municipios.filter((m) => m.capital).map(formatar), fonte: FONTE });
      }
      if (args.codigo_tse || args.codigo_ibge) {
        const m = args.codigo_tse ? tabela.porCodigoTse(args.codigo_tse) : tabela.porCodigoIbge(args.codigo_ibge!);
        if (!m) throw new Error("Nenhum município com esse código.");
        return respostaJson({ municipios: [formatar(m)], fonte: FONTE });
      }
      if (!args.nome) throw new Error("Informe `nome`, `codigo_tse`, `codigo_ibge` ou `capitais=true`.");
      let uf: string | undefined;
      if (args.uf) {
        uf = resolverUf(args.uf);
        if (!uf) throw new Error(`UF desconhecida: "${args.uf}".`);
      }
      const r = tabela.buscar(args.nome, uf);
      const avisos: string[] = [];
      if (r.criterio === "aproximado") avisos.push(`Nenhum município com esse nome; mostrando nomes parecidos.`);
      if (r.criterio === "exato" && r.municipios.length > 1) {
        avisos.push(`Há ${r.municipios.length} municípios com esse nome; confirme a UF com o usuário.`);
      }
      if (r.criterio === "nenhum") avisos.push("Nenhum município encontrado. Para cidades do exterior, use as ferramentas de locais de votação com uf=exterior.");
      return respostaJson({
        total: r.municipios.length,
        criterio: r.criterio,
        municipios: r.municipios.slice(0, 30).map(formatar),
        avisos: avisos.length ? avisos : undefined,
        fonte: FONTE,
      });
    }),
  );
}
