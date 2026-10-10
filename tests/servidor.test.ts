import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

let ctx: Awaited<ReturnType<typeof criarClienteTeste>>;
const chamar = (...a: Parameters<typeof ctx.chamar>) => ctx.chamar(...a);
beforeAll(async () => {
  ctx = await criarClienteTeste(await criarGerenciadorTeste());
});

describe("servidor MCP", () => {
  it("expõe as ferramentas", async () => {
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "baixar_base",
      "buscar_locais_votacao",
      "buscar_municipio",
      "contar_locais_votacao",
      "listar_bases",
      "locais_votacao_proximos",
      "onde_votar",
      "onde_votar_continuar",
      "progresso_downloads",
      "remover_base",
    ]);
  });
});

describe("ferramentas de locais de votação", () => {
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

describe("onde votar", () => {
  it("onde_votar valida os dados antes de consultar", async () => {
    const r = await chamar("onde_votar", { identificacao: "123", data_nascimento: "25/12/1980", nome_mae: "Ana Souza" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/CPF \(11 dígitos\)/);
  });

  it("onde_votar orienta a IA quando há desafio e onde_votar_continuar conclui", async () => {
    const { json } = await chamar("onde_votar", {
      identificacao: "529.982.247-25",
      data_nascimento: "25/12/1980",
      nome_mae: "Ana Souza",
    });
    expect(json).toMatchObject({ status: "desafio_pendente", sessao: "s1" });
    expect(json.instrucoes).toMatch(/onde_votar_continuar/);

    const fim = await chamar("onde_votar_continuar", { sessao: "s1" });
    expect(fim.json).toMatchObject({ status: "ok", eleitor: "FULANA", fonte: { url: expect.stringContaining("tn3.tse.jus.br") } });
  });
});
