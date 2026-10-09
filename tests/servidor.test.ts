import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { criarServidor } from "../src/server.js";
import type { Geocodificador } from "../src/services/geocoding/geocodificador.js";
import { FonteLocais } from "../src/services/locais-votacao/fonte.js";
import { carregarAmostra } from "./apoio.js";

const geocodificadorFalso: Geocodificador = {
  async geocodificar(endereco) {
    if (/206 sul/i.test(endereco)) {
      return { latitude: -15.8165, longitude: -47.8965, enderecoEncontrado: "SQS 206, Asa Sul, Brasília", fonte: "teste" };
    }
    return null;
  },
};

let client: Client;
beforeAll(async () => {
  const ondeVotarFalso = {
    consultar: async () => {
      throw new Error("não usado neste teste");
    },
    continuar: async () => {
      throw new Error("não usado neste teste");
    },
  };
  const server = criarServidor({
    locais: new FonteLocais(carregarAmostra),
    geocodificador: geocodificadorFalso,
    ondeVotar: ondeVotarFalso,
  });
  const [t1, t2] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "teste", version: "0" });
  await Promise.all([server.connect(t1), client.connect(t2)]);
});

async function chamar(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const texto = (r.content as { type: string; text: string }[])[0].text;
  return { erro: r.isError === true, texto, json: r.isError ? undefined : JSON.parse(texto) };
}

describe("servidor MCP", () => {
  it("expõe as ferramentas de locais de votação", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "buscar_locais_votacao",
      "contar_locais_votacao",
      "locais_votacao_proximos",
      "onde_votar",
      "onde_votar_continuar",
    ]);
  });

  it("quantos locais de votação há em NY?", async () => {
    const { json } = await chamar("contar_locais_votacao", { uf: "exterior", municipio: "NY" });
    expect(json.total_locais).toBe(2);
    expect(json.fonte.descricao).toMatch(/2026/);
  });

  it("local mais perto de um endereço", async () => {
    const { json } = await chamar("locais_votacao_proximos", { endereco: "SQS 206 Sul, Brasília", limite: 1 });
    expect(json.locais[0].nome).toBe("ESCOLA CLASSE 206 SUL");
    expect(json.origem.encontrado).toMatch(/Asa Sul/);
  });

  it("erro claro quando falta a origem ou o endereço não é encontrado", async () => {
    expect((await chamar("locais_votacao_proximos", {})).texto).toMatch(/Informe/);
    const r = await chamar("locais_votacao_proximos", { endereco: "lugar nenhum" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/Não foi possível localizar/);
  });
});
