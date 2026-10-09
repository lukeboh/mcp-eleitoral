#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { anoLocaisVotacao } from "./lib/config.js";
import { criarServidor } from "./server.js";
import { GeocodificadorNominatim } from "./services/geocoding/nominatim.js";
import { carregarBaseLocais } from "./services/locais-votacao/dataset.js";
import { FonteLocais } from "./services/locais-votacao/fonte.js";
import { ServicoOndeVotar } from "./services/onde-votar/consulta.js";

// stdout é o canal do protocolo MCP: logs vão para stderr.
const log = (msg: string) => console.error(`[mcp-eleitoral] ${msg}`);

const locais = new FonteLocais(() => carregarBaseLocais({ ano: anoLocaisVotacao(), log }));
const ondeVotar = new ServicoOndeVotar();
const server = criarServidor({ locais, geocodificador: new GeocodificadorNominatim(), ondeVotar });

// Fecha janelas de navegador pendentes quando o cliente MCP encerra o servidor.
const encerrar = () => void ondeVotar.encerrar().finally(() => process.exit(0));
process.stdin.on("close", encerrar);
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);

await server.connect(new StdioServerTransport());
log("Servidor iniciado (stdio).");

// Pré-carrega a base em segundo plano para a primeira pergunta ser rápida.
locais.iniciar().catch((e) => log(`Falha ao carregar locais de votação: ${e instanceof Error ? e.message : e}`));
