import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Contexto } from "./contexto.js";
import { registrarGestaoBases } from "./dados/ferramentas.js";
import { registrarServicos } from "./services/index.js";

export function criarServidor(ctx: Contexto): McpServer {
  const server = new McpServer(
    { name: "mcp-eleitoral", version: "0.2.0" },
    {
      instructions:
        "Ferramentas sobre serviços da Justiça Eleitoral brasileira (TSE), baseadas em dados abertos oficiais. " +
        "As consultas usam bases baixadas do portal do TSE. Quando uma ferramenta disser que a base ainda não foi baixada, " +
        "informe o tamanho do download ao usuário e só chame `baixar_base` depois que ele confirmar; " +
        "o andamento pode ser acompanhado com `progresso_downloads`. " +
        "Para perguntas de proximidade, peça ao usuário um endereço ou CEP — o servidor não conhece a localização dele.",
    },
  );
  registrarGestaoBases(server, ctx.bases);
  registrarServicos(server, ctx);
  return server;
}
