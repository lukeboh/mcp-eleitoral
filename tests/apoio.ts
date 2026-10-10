import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GerenciadorBases, type OpcoesGerenciador } from "../src/dados/gerenciador.js";
import { criarServidor } from "../src/server.js";
import type { Geocodificador } from "../src/services/geocoding/geocodificador.js";
import { definicoesBases } from "../src/services/index.js";
import type { DadosOndeVotar } from "../src/services/onde-votar/resposta.js";

/** Espelho reduzido do CDN do TSE (cdn.tse.jus.br/estatistica/sead/odsele/…) com amostras reais. */
export const DIR_TSE = fileURLToPath(new URL("./fixtures/tse/", import.meta.url));

export const urlFixture = (url: string) => pathToFileURL(join(DIR_TSE, url.replace(/^.*\/odsele\//, ""))).href;

export async function criarGerenciadorTeste(opcoes: Partial<OpcoesGerenciador> = {}) {
  return new GerenciadorBases(definicoesBases, {
    diretorio: await mkdtemp(join(tmpdir(), "mcp-eleitoral-teste-")),
    anoAtual: 2026,
    limiteAutomaticoBytes: Infinity,
    url: (def, p) => urlFixture(def.url(p)),
    ...opcoes,
  });
}

export const geocodificadorFalso: Geocodificador = {
  async geocodificar(endereco) {
    if (/206 sul/i.test(endereco)) {
      return { latitude: -15.8165, longitude: -47.8965, enderecoEncontrado: "SQS 206, Asa Sul, Brasília", fonte: "teste" };
    }
    return null;
  },
};

export const ondeVotarFalso = {
  consultar: async () => ({ status: "desafio_pendente" as const, sessao: "s1", expira_em: "2026-10-09T12:00:00Z" }),
  continuar: async () => ({
    status: "ok" as const,
    dados: { eleitor: "FULANA", local: { nome: "ESCOLA CLASSE 206 SUL" } } as DadosOndeVotar,
  }),
};

export async function criarClienteTeste(bases: GerenciadorBases) {
  const server = criarServidor({ bases, geocodificador: geocodificadorFalso, ondeVotar: ondeVotarFalso });
  const [t1, t2] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "teste", version: "0" });
  await Promise.all([server.connect(t1), client.connect(t2)]);
  const chamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const texto = (r.content as { type: string; text: string }[])[0].text;
    return { erro: r.isError === true, texto, json: r.isError ? undefined : JSON.parse(texto) };
  };
  return { client, chamar };
}
