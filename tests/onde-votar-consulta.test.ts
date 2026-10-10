import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { ErroConsulta, ServicoOndeVotar, type Desfecho, type Pagina } from "../src/services/onde-votar/consulta.js";
import type { CredenciaisEleitor } from "../src/services/onde-votar/credenciais.js";
import type { DadosOndeVotar } from "../src/services/onde-votar/resposta.js";

const CREDENCIAIS: CredenciaisEleitor = { identificacao: "52998224725", dataNascimento: "25121980", nomeMae: "Ana Souza" };
const DADOS = { eleitor: "FULANA", local: { nome: "ESCOLA" } } as DadosOndeVotar;
const nunca = <T>() => new Promise<T>(() => {});

/** Roteiro de uma tentativa: o que a página "faz" depois do clique em Entrar. */
interface Roteiro {
  /** Resultado final da API (pode chegar depois de um desafio). */
  final: Promise<Desfecho>;
  desafio?: boolean;
}

function montar(roteiros: Roteiro[], opcoes: { timeoutMs?: number; prazoDesafioMs?: number } = {}) {
  const aberturas: { visivel: boolean; fechar: ReturnType<typeof vi.fn> }[] = [];
  let atual = -1;
  const pagina: Pagina = {
    enviarLogin: async () => {},
    observarResposta: () => roteiros[atual].final,
    aguardarDesafio: () => (roteiros[atual].desafio ? Promise.resolve({ tipo: "desafio" }) : nunca()),
    mensagemNaTela: async () => "",
  };
  const servico = new ServicoOndeVotar({
    pagina,
    timeoutMs: opcoes.timeoutMs ?? 1000,
    prazoDesafioMs: opcoes.prazoDesafioMs,
    abrir: async ({ visivel }) => {
      atual++;
      const fechar = vi.fn(async () => {});
      aberturas.push({ visivel, fechar });
      return { page: {} as Page, fechar };
    },
  });
  return { servico, aberturas };
}

describe("ServicoOndeVotar", () => {
  it("sem desafio: consulta só no navegador invisível e fecha ao final", async () => {
    const { servico, aberturas } = montar([{ final: Promise.resolve({ tipo: "ok", dados: DADOS }) }]);
    await expect(servico.consultar(CREDENCIAIS)).resolves.toEqual({ status: "ok", dados: DADOS });
    expect(aberturas.map((a) => a.visivel)).toEqual([false]);
    expect(aberturas[0].fechar).toHaveBeenCalled();
  });

  it("erro de login vira ErroConsulta com a mensagem do TSE, sem abrir janela", async () => {
    const { servico, aberturas } = montar([{ final: Promise.resolve({ tipo: "erro", mensagem: "Dados não conferem." }) }]);
    const erro = await servico.consultar(CREDENCIAIS).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroConsulta);
    expect(erro.message).toBe("Dados não conferem.");
    expect(aberturas).toHaveLength(1);
  });

  it("tempo esgotado vira erro", async () => {
    const { servico } = montar([{ final: nunca() }], { timeoutMs: 50 });
    await expect(servico.consultar(CREDENCIAIS)).rejects.toThrow(/não respondeu a tempo/);
  });

  it("desafio no invisível: abre janela visível e, se o desafio não reaparecer, conclui direto", async () => {
    const { servico, aberturas } = montar([
      { final: nunca(), desafio: true },
      { final: Promise.resolve({ tipo: "ok", dados: DADOS }) },
    ]);
    await expect(servico.consultar(CREDENCIAIS)).resolves.toEqual({ status: "ok", dados: DADOS });
    expect(aberturas.map((a) => a.visivel)).toEqual([false, true]);
    expect(aberturas.every((a) => a.fechar.mock.calls.length > 0)).toBe(true);
  });

  it("desafio na janela visível: devolve sessão pendente e conclui depois que o usuário resolve", async () => {
    let resolver!: (d: Desfecho) => void;
    const final = new Promise<Desfecho>((r) => (resolver = r));
    const { servico, aberturas } = montar([
      { final: nunca(), desafio: true },
      { final, desafio: true },
    ]);

    const r = await servico.consultar(CREDENCIAIS);
    expect(r.status).toBe("desafio_pendente");
    if (r.status !== "desafio_pendente") return;
    expect(aberturas[1].fechar).not.toHaveBeenCalled(); // janela continua aberta

    // Usuário ainda não resolveu: continua pendente.
    await expect(servico.continuar(r.sessao, 20)).resolves.toMatchObject({ status: "desafio_pendente", sessao: r.sessao });

    resolver({ tipo: "ok", dados: DADOS });
    await expect(servico.continuar(r.sessao, 1000)).resolves.toEqual({ status: "ok", dados: DADOS });
    expect(aberturas[1].fechar).toHaveBeenCalled();
    await expect(servico.continuar(r.sessao)).rejects.toThrow(/não encontrada ou expirada/);
  });

  it("sessão pendente expira e fecha a janela", async () => {
    const { servico, aberturas } = montar(
      [
        { final: nunca(), desafio: true },
        { final: nunca(), desafio: true },
      ],
      { prazoDesafioMs: 30 },
    );
    const r = await servico.consultar(CREDENCIAIS);
    expect(r.status).toBe("desafio_pendente");
    await new Promise((res) => setTimeout(res, 80));
    expect(aberturas[1].fechar).toHaveBeenCalled();
    if (r.status === "desafio_pendente") await expect(servico.continuar(r.sessao)).rejects.toThrow(/expirada/);
  });

  it("executa uma consulta por vez", async () => {
    let ativos = 0;
    let maximo = 0;
    const servico = new ServicoOndeVotar({
      timeoutMs: 1000,
      pagina: {
        enviarLogin: async () => {},
        observarResposta: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { tipo: "ok", dados: DADOS };
        },
        aguardarDesafio: () => nunca(),
        mensagemNaTela: async () => "",
      },
      abrir: async () => {
        maximo = Math.max(maximo, ++ativos);
        return { page: {} as Page, fechar: async () => void ativos-- };
      },
    });
    await Promise.all([servico.consultar(CREDENCIAIS), servico.consultar(CREDENCIAIS), servico.consultar(CREDENCIAIS)]);
    expect(maximo).toBe(1);
  });
});
