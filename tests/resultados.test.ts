import { beforeAll, describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

// Amostras reais de 2026: DF completo, Campinas e Nova York (presidente), 3 locais de votação do DF.
let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  ({ chamar } = await criarClienteTeste(await criarGerenciadorTeste()));
});

describe("comparecimento_abstencao", () => {
  it("totais do DF (presidente como referência)", async () => {
    const { json } = await chamar("comparecimento_abstencao", { uf: "Distrito Federal" });
    expect(json).toMatchObject({ cargo_referencia: "Presidente", turno: 1, eleitores_aptos: 2258320, abstencoes: 426924, abstencao_pct: 18.9 });
  });

  it("agrupa por UF e rotula o exterior", async () => {
    const { json } = await chamar("comparecimento_abstencao", { agrupar_por: "uf" });
    expect(json.grupos[0]).toMatchObject({ local: "Exterior", eleitores_aptos: 38953, abstencoes: 28819 });
  });

  it("aceita cidade do exterior por apelido", async () => {
    const { json } = await chamar("comparecimento_abstencao", { municipio: "NY" });
    expect(json.regiao).toBe("NOVA YORK/ZZ");
  });
});

describe("resultado_eleicao", () => {
  it("quem ganhou para governador no DF (com feminino no cargo)", async () => {
    const { json } = await chamar("resultado_eleicao", { cargo: "governadora", uf: "df", limite: 3 });
    expect(json.cargo).toBe("Governador");
    expect(json.ranking[0]).toMatchObject({ candidato: "CELINA LEÃO", numero: 11, votos: 825530, situacao_na_eleicao: "2º TURNO" });
    expect(json.ranking[0].percentual_validos).toBeCloseTo((825530 / 1651394) * 100, 1);
    expect(json.totais.votos_validos).toBe(1651394);
  });

  it("presidente em um município, com aviso de que a situação é da eleição toda", async () => {
    const { json } = await chamar("resultado_eleicao", { cargo: "presidente", municipio: "campinas", limite: 2 });
    expect(json.ranking.map((r: { candidato: string }) => r.candidato)).toEqual(["FLAVIO BOLSONARO", "LULA"]);
    expect(json.ranking[0].votos).toBe(329733);
    expect(json.avisos.join(" ")).toMatch(/eleição inteira/);
  });

  it("deputado estadual no DF vira distrital; agrupado por partido", async () => {
    const { json } = await chamar("resultado_eleicao", { cargo: "deputado estadual", uf: "DF", agrupar_por: "partido", limite: 3 });
    expect(json.cargo).toBe("Deputado Distrital");
    expect(json.ranking.map((r: { partido: string; votos: number }) => [r.partido, r.votos])).toEqual([
      ["PL", 272579],
      ["REPUBLICANOS", 188188],
      ["PT", 175748],
    ]);
  });

  it("cargo inexistente lista os disponíveis", async () => {
    const r = await chamar("resultado_eleicao", { cargo: "prefeito", uf: "DF" });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/Cargos disponíveis: .*Governador/);
  });
});

describe("votos_candidato", () => {
  it("total e distribuição por zona", async () => {
    const { json } = await chamar("votos_candidato", { nome: "chico vigilante", agrupar_por: "zona", limite: 2 });
    expect(json).toMatchObject({ candidato: "CHICO VIGILANTE", partido: "PT", total_votos: 50046 });
    expect(json.por_zona.map((z: { local: string; votos: number }) => [z.local, z.votos])).toEqual([
      ["Zona 8/DF", 4053],
      ["Zona 16/DF", 3949],
    ]);
  });

  it("vários candidatos com o mesmo trecho de nome: pede para escolher", async () => {
    const { json } = await chamar("votos_candidato", { nome: "a" });
    expect(json.mensagem).toMatch(/Vários candidatos/);
  });
});

describe("resultado_local_votacao", () => {
  it("resultado da Escola Classe 206 Sul para presidente usa a base nacional (BR)", async () => {
    const { json } = await chamar("resultado_local_votacao", { uf: "DF", cargo: "presidente", local: "escola classe 206 sul" });
    expect(json.total_locais).toBe(1);
    expect(json.ranking.slice(0, 2).map((r: { numero: number; votos: number }) => [r.numero, r.votos])).toEqual([
      [13, 869],
      [22, 721],
    ]);
  });

  it("uma seção específica", async () => {
    const { json } = await chamar("resultado_local_votacao", { uf: "DF", cargo: "governador", zona: 1, secao: 164 });
    expect(json.secoes).toBe(1);
    expect(json.ranking[0]).toMatchObject({ numero: 13, votos: 88 });
  });

  it("por bairro, cruzando com a base de locais de votação", async () => {
    const { json } = await chamar("resultado_local_votacao", { uf: "DF", cargo: "governador", bairro: "taguatinga" });
    expect(json.locais.map((l: { nome: string }) => l.nome)).toEqual(["CENTRO DE ENSINO FUNDAMENTAL 17"]);
    expect(json.ranking[0]).toMatchObject({ numero: 11, votos: 1780 });
  });

  it("seção sem zona é recusada", async () => {
    const r = await chamar("resultado_local_votacao", { uf: "DF", cargo: "governador", secao: 164 });
    expect(r.erro).toBe(true);
  });
});
