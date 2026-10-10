import { diretorioCache, limiteDownloadAutomaticoBytes } from "./lib/config.js";
import { GerenciadorBases } from "./dados/gerenciador.js";
import { definicoesBases } from "./services/index.js";

export function criarGerenciador(log: (msg: string) => void): GerenciadorBases {
  return new GerenciadorBases(definicoesBases, {
    diretorio: diretorioCache(),
    limiteAutomaticoBytes: limiteDownloadAutomaticoBytes(),
    log,
  });
}
