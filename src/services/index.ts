import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "../contexto.js";
import type { DefinicaoBase } from "../dados/tipos.js";
import { baseLocaisVotacao } from "./locais-votacao/base.js";
import { registrarLocaisVotacao } from "./locais-votacao/ferramentas.js";
import { registrarOndeVotar } from "./onde-votar/ferramentas.js";

/**
 * Cada serviço eleitoral registra suas ferramentas e as bases de dados que usa.
 * Para adicionar um novo: crie `src/services/<servico>/` com `base.ts` e `ferramentas.ts` e inclua aqui.
 */
export const definicoesBases: DefinicaoBase[] = [baseLocaisVotacao];

const servicos: ((server: McpServer, ctx: Contexto) => void)[] = [
  registrarLocaisVotacao,
  registrarOndeVotar,
];

export function registrarServicos(server: McpServer, ctx: Contexto) {
  for (const registrar of servicos) registrar(server, ctx);
}
