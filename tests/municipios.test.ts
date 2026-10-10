import { beforeAll, describe, expect, it } from "vitest";
import type { TabelaMunicipios } from "../src/services/municipios/tabela.js";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

let tabela: TabelaMunicipios;
let chamar: Awaited<ReturnType<typeof criarClienteTeste>>["chamar"];
beforeAll(async () => {
  // Limite automático baixo, mas a base de municípios é pequena e baixa sem confirmação.
  const bases = await criarGerenciadorTeste({ limiteAutomaticoBytes: 10 * 1024 * 1024 });
  tabela = await bases.obter<TabelaMunicipios>("municipios");
  ({ chamar } = await criarClienteTeste(bases));
});

describe("tabela de municípios", () => {
  it("lê códigos TSE e IBGE e marca capitais", () => {
    expect(tabela.porCodigoIbge(5300108)).toMatchObject({ nome: "Brasília", uf: "DF", codigoTse: "97012", capital: true });
    expect(tabela.porCodigoTse(71072)).toMatchObject({ nome: "São Paulo", capital: true });
    expect(tabela.porCodigoIbge(5300108)!.nomeUf).toBe("Distrito Federal");
  });

  it("busca sem acento, por prefixo e com erro de digitação", () => {
    expect(tabela.buscar("brasilia").municipios.map((m) => m.uf)).toEqual(["DF"]);
    expect(tabela.buscar("sao jose dos").criterio).toBe("prefixo");
    const r = tabela.buscar("Campinsa");
    expect(r.criterio).toBe("aproximado");
    expect(r.municipios[0].nome).toBe("Campinas");
  });

  it("homônimos: capitais primeiro e filtro por UF", () => {
    const sp = tabela.buscar("São Paulo");
    expect(sp.criterio).toBe("exato");
    expect(sp.municipios[0].uf).toBe("SP");
    expect(tabela.buscar("Santa Maria").municipios.map((m) => m.uf).sort()).toEqual(["RN", "RS"]);
    expect(tabela.buscar("Santa Maria", "RS").municipios).toHaveLength(1);
  });
});

describe("ferramenta buscar_municipio", () => {
  it("avisa sobre homônimos", async () => {
    const { json } = await chamar("buscar_municipio", { nome: "santa maria" });
    expect(json.total).toBe(2);
    expect(json.avisos[0]).toMatch(/confirme a UF/);
  });

  it("aceita nome da UF e código", async () => {
    expect((await chamar("buscar_municipio", { nome: "santa maria", uf: "Rio Grande do Sul" })).json.municipios[0].codigo_ibge).toBe(4316907);
    expect((await chamar("buscar_municipio", { codigo_tse: "97012" })).json.municipios[0].nome).toBe("Brasília");
  });
});
