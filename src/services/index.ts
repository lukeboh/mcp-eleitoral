import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "../contexto.js";
import type { DefinicaoBase } from "../dados/tipos.js";
import { baseLocaisVotacao } from "./locais-votacao/base.js";
import { registrarLocaisVotacao } from "./locais-votacao/ferramentas.js";
import { baseMunicipios } from "./municipios/base.js";
import { registrarMunicipios } from "./municipios/ferramentas.js";
import { baseResultadosCandidatos, baseResultadosDetalhe, baseResultadosPartidos, baseVotacaoSecao } from "./resultados/bases.js";
import { registrarResultados } from "./resultados/ferramentas.js";
import { baseBensCandidatos, baseCandidatos, baseCandidatosComplementar, baseColigacoes, baseVagas } from "./candidatos/bases.js";
import { registrarCandidatos } from "./candidatos/ferramentas.js";
import { basePerfilComparecimento, basePerfilEleitorado } from "./perfil/bases.js";
import { registrarPerfil } from "./perfil/ferramentas.js";
import { basePrestacaoContas } from "./contas/bases.js";
import { registrarContas } from "./contas/ferramentas.js";
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
  baseCandidatos,
  baseCandidatosComplementar,
  baseBensCandidatos,
  baseColigacoes,
  baseVagas,
  basePerfilEleitorado,
  basePerfilComparecimento,
  basePrestacaoContas,
];

const servicos: ((server: McpServer, ctx: Contexto) => void)[] = [
  registrarMunicipios,
  registrarLocaisVotacao,
  registrarResultados,
  registrarCandidatos,
  registrarPerfil,
  registrarContas,
  registrarOndeVotar,
];

export function registrarServicos(server: McpServer, ctx: Contexto) {
  for (const registrar of servicos) registrar(server, ctx);
}
