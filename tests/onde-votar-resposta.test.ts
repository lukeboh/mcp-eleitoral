import { describe, expect, it } from "vitest";
import { mapearRespostaOndeVotar } from "../src/services/onde-votar/resposta.js";

// Respostas fictícias, no formato inferido do front-end do tn3 (ver docs/investigacao-onde-votar.md).
const respostaBrasil = {
  eleitor: { nomeCivil: "FULANA DE TAL", nomeSocial: null, inscricao: "012345678901", cpf: "não deve vazar" },
  situacaoEleitoral: { situacao: { nome: "REGULAR" }, mensagem: "Situação do título: REGULAR" },
  ondeVotara: {
    zona: "1",
    secao: "579",
    numeroLocal: "2003",
    nome: "ESCOLA CLASSE 206 SUL",
    endereco: "SQS 206 AREA ESPECIAL",
    bairro: "ASA SUL",
    municipio: "BRASÍLIA",
    uf: "DF",
    latitude: "-15,81637576",
    longitude: "-47.89644028",
  },
  mensagens: ["Leve um documento oficial com foto.", { mensagem: "Aviso em objeto" }, null],
};

describe("mapearRespostaOndeVotar", () => {
  it("mapeia um eleitor no Brasil", () => {
    const d = mapearRespostaOndeVotar(respostaBrasil);
    expect(d).toMatchObject({
      eleitor: "FULANA DE TAL",
      titulo: "012345678901",
      situacao_titulo: "REGULAR",
      local: {
        nome: "ESCOLA CLASSE 206 SUL",
        bairro: "ASA SUL",
        uf: "DF",
        pais: "BRASIL",
        exterior: false,
        zona: 1,
        secao: 579,
        numero_local: 2003,
        coordenadas: { latitude: -15.81637576, longitude: -47.89644028 },
      },
      mensagens: ["Leve um documento oficial com foto.", "Aviso em objeto"],
    });
    expect(d.local.mapa).toContain("-15.81637576,-47.89644028");
    expect(JSON.stringify(d)).not.toContain("não deve vazar");
  });

  it("prefere o nome social", () => {
    const d = mapearRespostaOndeVotar({ ...respostaBrasil, eleitor: { nomeCivil: "A B", nomeSocial: "C D" } });
    expect(d.eleitor).toBe("C D");
  });

  it("trata o exterior: país vem no bairro e não há coordenadas", () => {
    const d = mapearRespostaOndeVotar({
      eleitor: { nomeCivil: "FULANO" },
      ondeVotara: { zona: 1, secao: 290, nome: "QUEENS COLLEGE", bairro: "ESTADOS UNIDOS", municipio: "NOVA YORK", uf: "ZZ", latitude: "-1", longitude: "-1" },
    });
    expect(d.local).toMatchObject({ exterior: true, pais: "ESTADOS UNIDOS", bairro: null, uf: "ZZ", coordenadas: null, mapa: null });
  });

  it("usa domicilioEleitoral quando não há ondeVotara", () => {
    const d = mapearRespostaOndeVotar({ domicilioEleitoral: { nome: "LOCAL X", uf: "SP", zona: 5 } });
    expect(d.local.nome).toBe("LOCAL X");
  });

  it("falha com mensagem clara sem dados de local", () => {
    expect(() => mapearRespostaOndeVotar({ eleitor: {} })).toThrow(/sem dados de local/);
  });
});
