import { describe, expect, it } from "vitest";
import {
  cpfValido,
  montarCredenciais,
  normalizarDataNascimento,
  normalizarIdentificacao,
} from "../src/services/onde-votar/credenciais.js";

// CPFs gerados apenas para teste (dígitos verificadores válidos, sem relação com pessoas reais).
const CPF_TESTE = "52998224725";

describe("normalizarIdentificacao", () => {
  it("aceita CPF com ou sem pontuação e confere os dígitos", () => {
    expect(cpfValido(CPF_TESTE)).toBe(true);
    expect(normalizarIdentificacao("529.982.247-25")).toEqual({ tipo: "cpf", valor: CPF_TESTE });
    expect(() => normalizarIdentificacao("529.982.247-24")).toThrow(/CPF inválido/);
    expect(() => normalizarIdentificacao("111.111.111-11")).toThrow(/CPF inválido/);
  });

  it("aceita título com 12 dígitos", () => {
    expect(normalizarIdentificacao("0123 4567 8901")).toEqual({ tipo: "titulo", valor: "012345678901" });
  });

  it("rejeita números de outro tamanho", () => {
    expect(() => normalizarIdentificacao("12345")).toThrow(/11 dígitos/);
  });

  it("aceita nome completo e exige pelo menos dois nomes", () => {
    expect(normalizarIdentificacao("  Maria   da Silva ")).toEqual({ tipo: "nome", valor: "Maria da Silva" });
    expect(() => normalizarIdentificacao("Maria")).toThrow(/nome completo/);
  });
});

describe("normalizarDataNascimento", () => {
  it("aceita vários formatos e devolve ddmmaaaa", () => {
    for (const d of ["25/12/1980", "25-12-1980", "25.12.1980", "25121980", "1980-12-25"]) {
      expect(normalizarDataNascimento(d)).toBe("25121980");
    }
    expect(normalizarDataNascimento("5/3/1990")).toBe("05031990");
  });

  it("rejeita datas inexistentes, futuras ou mal formatadas", () => {
    expect(() => normalizarDataNascimento("31/02/1980")).toThrow();
    expect(() => normalizarDataNascimento("01/01/2999")).toThrow();
    expect(() => normalizarDataNascimento("ontem")).toThrow(/dd\/mm\/aaaa/);
  });
});

describe("montarCredenciais", () => {
  it("monta as credenciais normalizadas", () => {
    expect(
      montarCredenciais({ identificacao: "529.982.247-25", data_nascimento: "25/12/1980", nome_mae: " Ana  Souza " }),
    ).toEqual({ identificacao: CPF_TESTE, dataNascimento: "25121980", nomeMae: "Ana Souza" });
  });

  it("exige o nome da mãe", () => {
    expect(() => montarCredenciais({ identificacao: CPF_TESTE, data_nascimento: "25/12/1980", nome_mae: " " })).toThrow(
      /nome completo da mãe/,
    );
  });
});
