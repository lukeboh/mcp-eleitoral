import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  ({ chamar } = await criarClienteTeste(await criarGerenciadorTeste()));
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
