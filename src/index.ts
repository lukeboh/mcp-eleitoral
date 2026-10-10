#!/usr/bin/env node
import "./silenciar-avisos.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { criarGerenciador } from "./criar-gerenciador.js";
import { criarServidor } from "./server.js";
import { GeocodificadorNominatim } from "./services/geocoding/nominatim.js";
import { ServicoOndeVotar } from "./services/onde-votar/consulta.js";

// stdout é o canal do protocolo MCP: logs vão para stderr.
const log = (msg: string) => console.error(`[mcp-eleitoral] ${msg}`);

const bases = criarGerenciador(log);
const ondeVotar = new ServicoOndeVotar();
const server = criarServidor({ bases, geocodificador: new GeocodificadorNominatim(), ondeVotar });

// Fecha janelas de navegador pendentes quando o cliente MCP encerra o servidor.
const encerrar = () => void ondeVotar.encerrar().finally(() => process.exit(0));
process.stdin.on("close", encerrar);
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

await server.connect(new StdioServerTransport());
log("Servidor iniciado (stdio).");

// Abre em segundo plano as bases já baixadas, para a primeira pergunta ser rápida.
for (const m of await bases.baixadas()) {
  bases.obter(m.id, m.params).catch((e) => log(`Falha ao abrir ${m.id}: ${e instanceof Error ? e.message : e}`));
}
