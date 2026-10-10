import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

// Amostra real de 2026 (DF + presidente + 2 candidatas de SP), com CPF, título e nascimento mascarados.
let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  // Bases de candidatos são pequenas: baixam sem pedir confirmação mesmo com o limite padrão.
  ({ chamar } = await criarClienteTeste(await criarGerenciadorTeste({ limiteAutomaticoBytes: 10 * 1024 * 1024 })));
});

describe("buscar_candidatos", () => {
  it("lista candidatos a governador do DF", async () => {
    const { json } = await chamar("buscar_candidatos", { cargo: "governador", uf: "DF" });
    expect(json.total).toBe(11);
    expect(json.candidatos.map((c: { candidato: string }) => c.candidato)).toContain("CELINA LEÃO");
  });

  it("quem está no 2º turno (considera a situação de qualquer turno)", async () => {
    const { json } = await chamar("buscar_candidatos", { cargo: "governador", uf: "DF", situacao: "segundo_turno" });
    expect(json.candidatos.map((c: { candidato: string }) => c.candidato).sort()).toEqual(["CELINA LEÃO", "LEANDRO GRASS"]);
    expect(json.candidatos[0].situacao).toMatch(/2º turno/);
  });

  it("conta eleitos por partido e por gênero", async () => {
    const porPartido = await chamar("buscar_candidatos", { cargo: "deputado federal", uf: "DF", situacao: "eleito", agrupar_por: "partido" });
    expect(porPartido.json.total).toBe(8);
    expect(porPartido.json.grupos[0]).toMatchObject({ partido: "PL", candidatos: 3 });
    const mulheres = await chamar("buscar_candidatos", { cargo: "deputado federal", uf: "DF", situacao: "eleito", genero: "feminino" });
    expect(mulheres.json.total).toBe(0);
  });
});

describe("perfil_candidato", () => {
  it("ficha com coligação, idade, naturalidade e bens", async () => {
    const { json } = await chamar("perfil_candidato", { nome: "celina", cargo: "governador" });
    expect(json).toMatchObject({ candidato: "CELINA LEÃO", numero: 11, partido: "PP", idade_na_posse: 49, naturalidade: "GOIÂNIA/GO" });
    expect(json.composicao_coligacao).toMatch(/REPUBLICANOS/);
    expect(json.bens_declarados).toMatchObject({ quantidade: 5, valor_total: 440131.39 });
    expect(json).not.toHaveProperty("cpf");
  });

  it("nome ambíguo devolve a lista", async () => {
    const { json } = await chamar("perfil_candidato", { nome: "tabata" });
    expect(json.candidatos).toHaveLength(2);
  });
});

describe("ranking_patrimonio e vagas_e_coligacoes", () => {
  it("candidatos a governador mais ricos", async () => {
    const { json } = await chamar("ranking_patrimonio", { cargo: "governador", uf: "DF", limite: 2 });
    expect(json.ranking.map((r: { candidato: string; patrimonio_declarado: number }) => [r.candidato, r.patrimonio_declarado])).toEqual([
      ["KIKO CAPUTO", 47383036.13],
      ["PAULA BELMONTE", 10844220.79],
    ]);
  });

  it("vagas e coligações", async () => {
    expect((await chamar("vagas_e_coligacoes", { cargo: "deputado federal", uf: "São Paulo" })).json.vagas).toBe(70);
    const { json } = await chamar("vagas_e_coligacoes", { cargo: "governador", uf: "DF" });
    expect(json.vagas).toBe(1);
    const prop = json.agremiacoes.find((a: { nome: string }) => a.nome === "PROPÓSITO E AÇÃO");
    expect(prop.partidos).toContain("PL");
  });
});
