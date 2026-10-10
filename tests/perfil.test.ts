import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

// Amostras reais: todas as linhas de Bujari e Xapuri (AC), do perfil atual e do comparecimento de 2024.
let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  ({ chamar } = await criarClienteTeste(await criarGerenciadorTeste()));
});

describe("perfil_eleitorado", () => {
  it("total e por município", async () => {
    const { json } = await chamar("perfil_eleitorado", { uf: "Acre", agrupar_por: "municipio" });
    expect(json.eleitores).toBe(23938);
    expect(json.grupos.map((g: { municipio: string; eleitores: number }) => [g.municipio, g.eleitores])).toEqual([
      ["XAPURI/AC", 12788],
      ["BUJARI/AC", 11150],
    ]);
    expect(json.com_biometria_pct).toBeCloseTo((22860 / 23938) * 100, 1);
  });

  it("jovens de 16 e 17 anos", async () => {
    expect((await chamar("perfil_eleitorado", { uf: "AC", idade_max: 17 })).json.eleitores).toBe(415);
  });

  it("filtros cruzados: mulheres com superior completo", async () => {
    expect((await chamar("perfil_eleitorado", { genero: "feminino", grau_instrucao: "superior completo" })).json.eleitores).toBe(814);
  });

  it("agrupa por instrução, na ordem dos códigos do TSE", async () => {
    const { json } = await chamar("perfil_eleitorado", { agrupar_por: "grau_instrucao" });
    expect(json.grupos[0].grau_instrucao).toBe("ANALFABETO");
    const fund = json.grupos.find((g: { grau_instrucao: string }) => g.grau_instrucao === "ENSINO FUNDAMENTAL INCOMPLETO");
    expect(fund.eleitores).toBe(5990);
  });

  it("zona aceita filtros combinados; dimensões não cruzadas usam as marginais, uma por vez", async () => {
    expect((await chamar("perfil_eleitorado", { uf: "AC", zona: 9 })).json.eleitores).toBe(11150);
    const zona = await chamar("perfil_eleitorado", { uf: "AC", zona: 9, genero: "feminino", agrupar_por: "grau_instrucao" });
    expect(zona.erro).toBe(false);
    expect((await chamar("perfil_eleitorado", { identidade_genero: "transgênero" })).json.eleitores).toBe(19);
    const r = await chamar("perfil_eleitorado", { identidade_genero: "transgênero", genero: "feminino" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/uma dimensão por vez/);
  });

  it("valor inválido lista as opções", async () => {
    const r = await chamar("perfil_eleitorado", { grau_instrucao: "doutorado" });
    expect(r.texto).toMatch(/Opções: .*SUPERIOR COMPLETO/);
  });
});

describe("perfil_comparecimento", () => {
  it("usa só o CSV nacional (sem contar a UF em dobro) e o ano mais recente publicado", async () => {
    const { json } = await chamar("perfil_comparecimento", { uf: "AC" });
    expect(json).toMatchObject({ ano: 2024, turno: 1, aptos: 24884, abstencao: 4852 });
  });

  it("abstenção por faixa etária", async () => {
    const { json } = await chamar("perfil_comparecimento", { agrupar_por: "faixa_etaria", limite: 50 });
    const faixa = (f: string) => json.grupos.find((g: { faixa_etaria: string }) => g.faixa_etaria === f);
    expect(faixa("16 anos")).toMatchObject({ aptos: 331, abstencao_pct: 7.85 });
    expect(faixa("70 a 74 anos").abstencao_pct).toBe(33.76);
  });

  it("filtra por gênero", async () => {
    expect((await chamar("perfil_comparecimento", { genero: "feminino" })).json).toMatchObject({ aptos: 12155, abstencao: 2070 });
  });
});
