import { randomUUID } from "node:crypto";
import type { Page, Response } from "playwright-core";
import type { CredenciaisEleitor } from "./credenciais.js";
import { abrirNavegador, type AbrirNavegador, type SessaoNavegador } from "./navegador.js";
import { mapearRespostaOndeVotar, type DadosOndeVotar } from "./resposta.js";

export const URL_ONDE_VOTAR = "https://tn3.tse.jus.br/#/atendimento-eleitor/onde-votar";
const API_LOGIN = "/eleitor-oauth/oauth/token";
const API_ONDE_VOTAR = "/v3/eleitores/onde-votar";

export type ResultadoConsulta =
  | { status: "ok"; dados: DadosOndeVotar }
  | { status: "desafio_pendente"; sessao: string; expira_em: string };

/** Erro com mensagem destinada ao usuário (dados não conferem, serviço indisponível…). */
export class ErroConsulta extends Error {}

export type Desfecho =
  | { tipo: "ok"; dados: DadosOndeVotar }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "desafio" };

interface SessaoDesafio {
  navegador: SessaoNavegador;
  desfecho: Promise<Desfecho>;
  expiraEm: number;
  timer: NodeJS.Timeout;
}

/** Passos que dependem da página do TSE. Separados para permitir testes sem navegador. */
export interface Pagina {
  /** Abre a página, preenche o login e clica em "Entrar". */
  enviarLogin(page: Page, credenciais: CredenciaisEleitor, timeoutMs: number): Promise<void>;
  /** Resolve com o resultado ou o erro devolvido pela API. Continua valendo após um desafio. */
  observarResposta(page: Page): Promise<Desfecho>;
  /** Resolve quando o hCaptcha exibe um desafio. */
  aguardarDesafio(page: Page): Promise<Desfecho>;
  mensagemNaTela(page: Page): Promise<string>;
}

export interface OpcoesServico {
  abrir?: AbrirNavegador;
  pagina?: Pagina;
  /** Tempo máximo para o TSE responder quando não há desafio. */
  timeoutMs?: number;
  /** Quanto tempo a janela fica aberta aguardando o usuário resolver o desafio. */
  prazoDesafioMs?: number;
}

/**
 * Consulta "Onde votar" no Autoatendimento Eleitoral, fazendo no navegador o que o
 * eleitor faria: preenche o login e lê a resposta oficial.
 *
 * O hCaptcha do site é respeitado, nunca contornado. Normalmente ele valida em
 * segundo plano e tudo acontece num navegador invisível. Só quando ele decide exigir
 * um desafio é aberta uma janela visível para o próprio usuário resolvê-lo.
 */
export class ServicoOndeVotar {
  private readonly abrir: AbrirNavegador;
  private readonly pagina: Pagina;
  private readonly timeoutMs: number;
  private readonly prazoDesafioMs: number;
  private readonly sessoes = new Map<string, SessaoDesafio>();
  /** Uma consulta por vez: o uso é individual, nunca em massa. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(opcoes: OpcoesServico = {}) {
    this.abrir = opcoes.abrir ?? abrirNavegador;
    this.pagina = opcoes.pagina ?? paginaTn3;
    this.timeoutMs = opcoes.timeoutMs ?? 45_000;
    this.prazoDesafioMs = opcoes.prazoDesafioMs ?? 5 * 60_000;
  }

  consultar(credenciais: CredenciaisEleitor): Promise<ResultadoConsulta> {
    const execucao = this.fila.then(() => this.executar(credenciais));
    this.fila = execucao.catch(() => {});
    return execucao;
  }

  /** Aguarda o resultado depois que o usuário resolveu o desafio na janela aberta. */
  async continuar(sessao: string, esperaMs = 90_000): Promise<ResultadoConsulta> {
    const s = this.sessoes.get(sessao);
    if (!s) throw new ErroConsulta("Sessão de consulta não encontrada ou expirada. Faça a consulta novamente.");
    const desfecho = await comPrazo<Desfecho>(s.desfecho, esperaMs, { tipo: "desafio" });
    if (desfecho.tipo === "desafio") {
      return { status: "desafio_pendente", sessao, expira_em: new Date(s.expiraEm).toISOString() };
    }
    await this.encerrarSessao(sessao);
    return concluir(desfecho);
  }

  async encerrar(): Promise<void> {
    await Promise.all([...this.sessoes.keys()].map((id) => this.encerrarSessao(id)));
  }

  private async executar(credenciais: CredenciaisEleitor): Promise<ResultadoConsulta> {
    // 1ª tentativa: invisível. É o caminho normal.
    const invisivel = await this.tentar(credenciais, false);
    await invisivel.navegador.fechar();
    if (invisivel.desfecho.tipo !== "desafio") return concluir(invisivel.desfecho);

    // O hCaptcha exigiu interação humana: refaz a consulta numa janela visível.
    const visivel = await this.tentar(credenciais, true);
    if (visivel.desfecho.tipo !== "desafio") {
      await visivel.navegador.fechar();
      return concluir(visivel.desfecho);
    }

    const id = randomUUID();
    const expiraEm = Date.now() + this.prazoDesafioMs;
    this.sessoes.set(id, {
      navegador: visivel.navegador,
      desfecho: visivel.final,
      expiraEm,
      timer: setTimeout(() => void this.encerrarSessao(id), this.prazoDesafioMs).unref(),
    });
    return { status: "desafio_pendente", sessao: id, expira_em: new Date(expiraEm).toISOString() };
  }

  private async encerrarSessao(id: string) {
    const s = this.sessoes.get(id);
    if (!s) return;
    this.sessoes.delete(id);
    clearTimeout(s.timer);
    await s.navegador.fechar();
  }

  /**
   * Preenche o login e espera o primeiro desfecho: resultado, erro ou desafio do captcha.
   * `final` continua aguardando o resultado depois de um desafio (o usuário pode resolvê-lo).
   */
  private async tentar(credenciais: CredenciaisEleitor, visivel: boolean) {
    const navegador = await this.abrir({ visivel });
    const { page } = navegador;
    try {
      const final = this.pagina.observarResposta(page);
      await this.pagina.enviarLogin(page, credenciais, this.timeoutMs);
      const prazo = sleep(this.timeoutMs).then(async (): Promise<Desfecho> => {
        const tela = await this.pagina.mensagemNaTela(page);
        const padrao = "O TSE não respondeu a tempo. Tente novamente em instantes.";
        return { tipo: "erro", mensagem: tela ? `${padrao} Mensagem exibida pelo site: ${tela}` : padrao };
      });
      const desfecho = await Promise.race([final, this.pagina.aguardarDesafio(page), prazo]);
      return { navegador, desfecho, final };
    } catch (e) {
      await navegador.fechar();
      throw new ErroConsulta(
        `Falha ao acessar o Autoatendimento Eleitoral (${URL_ONDE_VOTAR}): ${e instanceof Error ? e.message.split("\n")[0] : e}`,
      );
    }
  }
}

function concluir(d: Desfecho): ResultadoConsulta {
  if (d.tipo === "erro") throw new ErroConsulta(d.mensagem);
  if (d.tipo === "desafio") throw new ErroConsulta("O desafio do captcha não foi resolvido.");
  return { status: "ok", dados: d.dados };
}

/** Implementação real, sobre a página do tn3.tse.jus.br. */
export const paginaTn3: Pagina = {
  async enviarLogin(page, credenciais, timeoutMs) {
    await page.goto(URL_ONDE_VOTAR, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const campoId = page.locator("#titulo-cpf-nome");
    await campoId.waitFor({ state: "visible", timeout: timeoutMs });
    await campoId.fill(credenciais.identificacao);
    const campoData = page.locator("#dataNascimento");
    await campoData.click();
    await campoData.pressSequentially(credenciais.dataNascimento, { delay: 40 });
    await page.locator("#nomeMae").fill(credenciais.nomeMae);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  },

  observarResposta(page) {
    return new Promise((resolve) => {
      const tratar = async (res: Response) => {
        if (res.request().method() !== "POST") return;
        const url = res.url();
        if (url.includes(API_LOGIN) && !res.ok()) {
          const corpo = await res.json().catch(() => ({}));
          resolve({ tipo: "erro", mensagem: corpo?.error_description || `Login recusado pelo TSE (HTTP ${res.status()}).` });
        } else if (url.includes(API_ONDE_VOTAR)) {
          if (!res.ok()) {
            resolve({ tipo: "erro", mensagem: `O serviço Onde votar do TSE respondeu com erro (HTTP ${res.status()}).` });
            return;
          }
          try {
            resolve({ tipo: "ok", dados: mapearRespostaOndeVotar(await res.json()) });
          } catch (e) {
            resolve({ tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) });
          }
        }
      };
      page.on("response", (res) => void tratar(res));
      page.on("close", () => resolve({ tipo: "erro", mensagem: "A janela do navegador foi fechada antes da conclusão." }));
    });
  },

  async aguardarDesafio(page) {
    // O hCaptcha mantém o quadro do desafio escondido fora da tela até decidir exibi-lo.
    const quadro = page.locator('iframe[src*="hcaptcha"][src*="frame=challenge"]');
    for (;;) {
      await sleep(500);
      if (page.isClosed()) return new Promise<Desfecho>(() => {});
      const n = await quadro.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const item = quadro.nth(i);
        const caixa = await item.boundingBox().catch(() => null);
        const visivel = await item.isVisible().catch(() => false);
        if (visivel && caixa && caixa.width > 50 && caixa.height > 50 && caixa.y > -1000) return { tipo: "desafio" };
      }
    }
  },

  async mensagemNaTela(page) {
    const texto = await page
      .locator(".modal-body:visible, [role=dialog]:visible")
      .last()
      .innerText({ timeout: 1000 })
      .catch(() => "");
    return texto.trim().slice(0, 300);
  },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function comPrazo<T>(p: Promise<T>, ms: number, valor: T): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => valor)]);
}
