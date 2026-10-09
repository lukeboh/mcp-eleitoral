import { describe, expect, it } from "vitest";
import { carregarAmostra } from "./apoio.js";

describe("lerCsvLocais", () => {
  it("agrega seções por local e ignora o 2º turno", async () => {
    const { metadados, locais } = await carregarAmostra();
    expect(metadados.ano).toBe(2026);
    expect(metadados.totalLocais).toBe(8);

    const ec206 = locais.find((l) => l.nome === "ESCOLA CLASSE 206 SUL")!;
    expect(ec206).toMatchObject({ uf: "DF", municipio: "BRASÍLIA", zona: 1, bairro: "ASA SUL", acessivel: true });
    expect(new Set(ec206.secoes).size).toBe(ec206.secoes.length); // sem duplicar por turno
    expect(ec206.latitude).toBeCloseTo(-15.816, 2);
    expect(ec206.eleitores).toBeGreaterThan(0);
  });

  it("trata ausências do exterior (coordenadas -1, CEP 11111111) como null", async () => {
    const { locais } = await carregarAmostra();
    const queens = locais.find((l) => l.municipio === "NOVA YORK")!;
    expect(queens.uf).toBe("ZZ");
    expect(queens.latitude).toBeNull();
    expect(queens.cep).toBeNull();
  });
});
