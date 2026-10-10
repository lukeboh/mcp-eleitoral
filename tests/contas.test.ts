import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

// Amostra real de 2026: receitas e despesas dos candidatos a governador e senador do DF,
// com CPF e nome de pessoas físicas (doadores/fornecedores) pseudonimizados.
let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  ({ chamar } = await criarClienteTeste(await criarGerenciadorTeste()));
});

describe("financas_candidato", () => {
  it("receitas por origem, despesas por categoria e teto", async () => {
    const { json } = await chamar("financas_candidato", { nome: "celina leao", cargo: "governador" });
    expect(json).toMatchObject({ candidato: "CELINA LEAO HIZIM FERREIRA", partido: "PP" });
    expect(json.receitas.total).toBe(10093700);
    expect(json.receitas.por_origem[0]).toMatchObject({ origem: "Fundo Especial de Financiamento de Campanha (FEFC)", total: 5750000 });
    expect(json.receitas.por_origem[1]).toMatchObject({ origem: "Fundo Partidário", total: 3807700 });
    expect(json.despesas_contratadas.total).toBe(6111061.76);
    expect(json.despesas_contratadas.por_categoria[0]).toMatchObject({ categoria: "Atividades de militância e mobilização de rua", total: 4231222.32 });
  });

  it("não expõe CPF de pessoa física", async () => {
    const { texto } = await chamar("financas_candidato", { nome: "celina leao", cargo: "governador", limite: 50 });
    expect(texto).not.toMatch(/00000000000/);
  });
});

describe("ranking_financas", () => {
  it("quem mais arrecadou", async () => {
    const { json } = await chamar("ranking_financas", { tipo: "receitas", uf: "DF", limite: 2 });
    expect(json.ranking.map((r: { total: number }) => r.total)).toEqual([10093700, 4302500]);
  });

  it("fundo eleitoral por partido (aceita 'fundo eleitoral')", async () => {
    const { json } = await chamar("ranking_financas", { tipo: "receitas", origem: "fundo eleitoral", agrupar_por: "partido", limite: 3 });
    expect(json.total).toBe(31980494.47);
    expect(json.ranking.map((r: { partido: string }) => r.partido)).toEqual(["PL", "PSD", "PT"]);
  });

  it("maiores fornecedores e busca por CNPJ", async () => {
    const { json } = await chamar("ranking_financas", { tipo: "despesas", cargo: "governador", agrupar_por: "fornecedor", limite: 1 });
    expect(json.ranking[0].fornecedor).toMatch(/FACEBOOK SERVICOS ONLINE DO BRASIL LTDA\. — CNPJ 13347016000117/);
    expect(json.ranking[0].total).toBe(728876);
    const porCnpj = await chamar("ranking_financas", { tipo: "despesas", fornecedor: "13.347.016/0001-17" });
    expect(porCnpj.json.total).toBeGreaterThanOrEqual(728876);
  });

  it("filtra categoria e recusa combinações sem sentido", async () => {
    expect((await chamar("ranking_financas", { tipo: "despesas", categoria: "impulsionamento" })).json.total).toBe(2675876);
    expect((await chamar("ranking_financas", { tipo: "receitas", fornecedor: "x" })).erro).toBe(true);
  });
});
