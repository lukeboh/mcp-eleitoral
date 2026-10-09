import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "../contexto.js";
import { registrarLocaisVotacao } from "./locais-votacao/ferramentas.js";
import { registrarOndeVotar } from "./onde-votar/ferramentas.js";

/**
 * Cada serviço eleitoral registra suas ferramentas aqui.
 * Para adicionar um novo: crie `src/services/<servico>/ferramentas.ts` e inclua na lista.
 */
const servicos: ((server: McpServer, ctx: Contexto) => void)[] = [
  registrarLocaisVotacao,
  registrarOndeVotar,
];

export function registrarServicos(server: McpServer, ctx: Contexto) {
  for (const registrar of servicos) registrar(server, ctx);
}
