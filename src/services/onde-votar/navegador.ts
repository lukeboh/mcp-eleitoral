import { chromium, type Browser, type Page } from "playwright-core";
import { navegadorConfigurado } from "../../lib/config.js";

export interface SessaoNavegador {
  page: Page;
  fechar(): Promise<void>;
}

export type AbrirNavegador = (opcoes: { visivel: boolean }) => Promise<SessaoNavegador>;

async function lancar(visivel: boolean): Promise<Browser> {
  const configurado = navegadorConfigurado();
  const tentativas = configurado ? [configurado] : ["chrome", "msedge"];
  const erros: string[] = [];
  for (const alvo of tentativas) {
    const ehCaminho = /[\\/]/.test(alvo);
    try {
      return await chromium.launch({
        ...(ehCaminho ? { executablePath: alvo } : { channel: alvo }),
        headless: !visivel,
        args: visivel ? ["--window-size=1100,850"] : [],
      });
    } catch (e) {
      erros.push(`${alvo}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  throw new Error(
    "Não foi possível abrir o Google Chrome nem o Microsoft Edge para consultar o TSE. " +
      `Instale um deles ou defina MCP_ELEITORAL_NAVEGADOR. Detalhes: ${erros.join("; ")}`,
  );
}

/**
 * Abre o navegador instalado na máquina (Chrome/Edge) com um perfil temporário,
 * descartado ao fechar: nenhum cookie ou dado da consulta fica gravado.
 */
export const abrirNavegador: AbrirNavegador = async ({ visivel }) => {
  const browser = await lancar(visivel);
  const contexto = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await contexto.newPage();
  if (visivel) await page.bringToFront();
  return { page, fechar: () => browser.close().catch(() => {}) };
};
