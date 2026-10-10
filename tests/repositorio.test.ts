import { beforeAll, describe, expect, it } from "vitest";
import type { RepositorioLocais } from "../src/services/locais-votacao/repositorio.js";
import { criarGerenciadorTeste } from "./apoio.js";

let repo: RepositorioLocais;
beforeAll(async () => {
  repo = await (await criarGerenciadorTeste()).obter<RepositorioLocais>("locais-votacao");
});

describe("contar", () => {
  it("Brasil exclui o exterior; por padrão só ativos e convencionais", () => {
    expect(repo.contar({ escopo: "brasil" }).locais).toBe(3);
    expect(repo.contar({ escopo: "brasil", incluirEspeciais: true }).locais).toBe(4);
    expect(repo.contar({ escopo: "brasil", incluirEspeciais: true, incluirInativos: true }).locais).toBe(5);
  });

  it("aceita UF por nome e 'exterior'", () => {
    expect(repo.contar({ uf: "Distrito Federal" }).locais).toBe(3);
    expect(repo.contar({ uf: "exterior" }).locais).toBe(3);
    expect(repo.contar({ uf: "XX" }).avisos[0]).toMatch(/UF desconhecida/);
  });

  it("entende apelidos de cidades do exterior", () => {
    for (const nome of ["NY", "New York", "nova iorque", "Nova York"]) {
      expect(repo.contar({ uf: "exterior", municipio: nome }).locais).toBe(2);
    }
  });

  it("agrupa por município", () => {
    const c = repo.contar({}, "municipio");
    expect(c.grupos!.map((g) => g.chave)).toEqual(["BRASÍLIA/DF", "NOVA YORK/ZZ", "BOSTON/ZZ"]);
  });
});

describe("filtrar", () => {
  it("encontra o local pela zona e seção", () => {
    const secao = repo.filtrar({ uf: "DF", zona: 1 }).locais[0].secoes[0];
    const { locais } = repo.filtrar({ uf: "DF", zona: 1, secao });
    expect(locais.map((l) => l.nome)).toEqual(["ESCOLA CLASSE 206 SUL"]);
  });

  it("busca por bairro ignorando acentos e caixa", () => {
    expect(repo.filtrar({ bairro: "taguatinga" }).locais).toHaveLength(1);
  });
});

describe("maisProximos", () => {
  it("ordena por distância e ignora locais sem coordenadas", () => {
    // Próximo à SQS 206, Asa Sul
    const r = repo.maisProximos({ latitude: -15.8165, longitude: -47.8965 }, { limite: 10 });
    expect(r.locais[0].nome).toBe("ESCOLA CLASSE 206 SUL");
    expect(r.locais[0].distanciaKm).toBeLessThan(0.5);
    expect(r.locais.map((l) => l.distanciaKm)).toEqual([...r.locais.map((l) => l.distanciaKm)].sort((a, b) => a - b));
    expect(r.semCoordenadas).toBe(3);
  });

  it("respeita o raio", () => {
    const r = repo.maisProximos({ latitude: -15.8165, longitude: -47.8965 }, { raioKm: 1 });
    expect(r.locais).toHaveLength(1);
  });
});
