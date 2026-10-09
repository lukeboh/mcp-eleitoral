#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { anoLocaisVotacao } from "./lib/config.js";
import { criarServidor } from "./server.js";
import { GeocodificadorNominatim } from "./services/geocoding/nominatim.js";
import { carregarBaseLocais } from "./services/locais-votacao/dataset.js";
import { FonteLocais } from "./services/locais-votacao/fonte.js";

// stdout é o canal do protocolo MCP: logs vão para stderr.
const log = (msg: string) => console.error(`[mcp-eleitoral] ${msg}`);

const locais = new FonteLocais(() => carregarBaseLocais({ ano: anoLocaisVotacao(), log }));
const server = criarServidor({ locais, geocodificador: new GeocodificadorNominatim() });

await server.connect(new StdioServerTransport());
log("Servidor iniciado (stdio).");

// Pré-carrega a base em segundo plano para a primeira pergunta ser rápida.
locais.iniciar().catch((e) => log(`Falha ao carregar locais de votação: ${e instanceof Error ? e.message : e}`));
