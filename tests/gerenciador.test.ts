import { describe, expect, it } from "vitest";
import { criarClienteTeste, criarGerenciadorTeste } from "./apoio.js";

describe("gerenciamento de bases", () => {
  it("base grande: avisa o tamanho, pede confirmação e só então baixa", async () => {
    const bases = await criarGerenciadorTeste({ limiteAutomaticoBytes: 1 });
    const { chamar } = await criarClienteTeste(bases);

    const consulta = await chamar("contar_locais_votacao", { uf: "DF" });
    expect(consulta.erro).toBe(true);
    expect(consulta.texto).toMatch(/ainda não foi baixada/);
    expect(consulta.texto).toMatch(/Download: [\d.]+ MB/);
    expect(consulta.texto).toMatch(/baixar_base/);

    const lista = await chamar("listar_bases");
    const locais = lista.json.bases.find((b: { base: string }) => b.base === "locais-votacao");
    expect(locais).toMatchObject({ situacao: "nao_baixada", ano_padrao: 2026 });
    expect(locais.tamanho_download).toMatch(/MB/);

    const inicio = await chamar("baixar_base", { base: "locais-votacao" });
    expect(inicio.json.mensagem).toMatch(/segundo plano/);

    await waitFor(() => bases.progressos()[0]?.fase === "pronta");
    const progresso = await chamar("progresso_downloads");
    expect(progresso.json.downloads[0]).toMatchObject({ base: "locais-votacao", fase: "pronta", percentual: 100 });

    expect((await chamar("contar_locais_votacao", { uf: "DF" })).json.total_locais).toBe(4);

    const depois = await chamar("listar_bases", { base: "locais-votacao" });
    expect(depois.json).toMatchObject({ situacao: "pronta", atualizacao_disponivel: false });

    expect((await chamar("remover_base", { base: "locais-votacao" })).json.removida).toBe(true);
    expect((await chamar("contar_locais_votacao", { uf: "DF" })).erro).toBe(true);
  });

  it("baixar_base com aguardar envia notificações de progresso", async () => {
    const bases = await criarGerenciadorTeste({ limiteAutomaticoBytes: 1 });
    const { client } = await criarClienteTeste(bases);
    const notificacoes: unknown[] = [];
    const r = await client.callTool(
      { name: "baixar_base", arguments: { base: "locais-votacao", aguardar: true } },
      undefined,
      { onprogress: (p) => notificacoes.push(p) },
    );
    expect(JSON.parse((r.content as { text: string }[])[0].text).situacao).toBe("pronta");
    expect(notificacoes.length).toBeGreaterThan(0);
  });

  it("ano inexistente e UF errada geram mensagens claras", async () => {
    const bases = await criarGerenciadorTeste();
    await expect(bases.obter("locais-votacao", { ano: 2019 })).rejects.toThrow(/não está publicada/);
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 10_000) {
  const fim = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
