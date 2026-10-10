import { describe, expect, it } from "vitest";
import type { RepositorioLocais } from "../src/services/locais-votacao/repositorio.js";
import { criarGerenciadorTeste } from "./apoio.js";

describe("base de locais de votação", () => {
  it("agrega seções por local, ignora o 2º turno e trata ausências do exterior", async () => {
    const bases = await criarGerenciadorTeste();
    const repo = await bases.obter<RepositorioLocais>("locais-votacao");
    const { metadados } = repo;
    expect(metadados.ano).toBe(2026);
    expect(metadados.totalLocais).toBe(8);

    const [ec206] = repo.filtrar({ nome: "ESCOLA CLASSE 206 SUL" }).locais;
    expect(ec206).toMatchObject({ uf: "DF", municipio: "BRASÍLIA", zona: 1, bairro: "ASA SUL", acessivel: true });
    expect(new Set(ec206.secoes).size).toBe(ec206.secoes.length);
    expect(ec206.latitude).toBeCloseTo(-15.816, 2);

    const [queens] = repo.filtrar({ municipio: "NOVA YORK" }).locais;
    expect(queens.uf).toBe("ZZ");
    expect(queens.latitude).toBeNull();
    expect(queens.cep).toBeNull();
  });
});
