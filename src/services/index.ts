import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "../contexto.js";
import type { DefinicaoBase } from "../dados/tipos.js";
import { baseLocaisVotacao } from "./locais-votacao/base.js";
import { registrarLocaisVotacao } from "./locais-votacao/ferramentas.js";
import { baseMunicipios } from "./municipios/base.js";
import { registrarMunicipios } from "./municipios/ferramentas.js";
import { baseResultadosCandidatos, baseResultadosDetalhe, baseResultadosPartidos, baseVotacaoSecao } from "./resultados/bases.js";
import { registrarResultados } from "./resultados/ferramentas.js";
import { registrarOndeVotar } from "./onde-votar/ferramentas.js";

/**
 * Cada serviço eleitoral registra suas ferramentas e as bases de dados que usa.
 * Para adicionar um novo: crie `src/services/<servico>/` com `base.ts` e `ferramentas.ts` e inclua aqui.
 */
export const definicoesBases: DefinicaoBase[] = [
  baseMunicipios,
  baseLocaisVotacao,
  baseResultadosDetalhe,
  baseResultadosCandidatos,
  baseResultadosPartidos,
  baseVotacaoSecao,
];

const servicos: ((server: McpServer, ctx: Contexto) => void)[] = [
  registrarMunicipios,
  registrarLocaisVotacao,
  registrarResultados,
  registrarOndeVotar,
];

export function registrarServicos(server: McpServer, ctx: Contexto) {
  for (const registrar of servicos) registrar(server, ctx);
}
