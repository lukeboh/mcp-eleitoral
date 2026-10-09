import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "./contexto.js";
import { registrarServicos } from "./services/index.js";

export function criarServidor(ctx: Contexto): McpServer {
  const server = new McpServer(
    { name: "mcp-eleitoral", version: "0.1.0" },
    {
      instructions:
        "Ferramentas sobre serviços da Justiça Eleitoral brasileira (TSE), baseadas em dados abertos oficiais. " +
        "Para perguntas de proximidade, peça ao usuário um endereço ou CEP — o servidor não conhece a localização dele.",
    },
  );
  registrarServicos(server, ctx);
  return server;
}
