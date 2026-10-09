import { RepositorioLocais } from "./repositorio.js";
import type { BaseLocais } from "./tipos.js";

export class BaseEmPreparacao extends Error {
  constructor() {
    super(
      "A base de locais de votação do TSE está sendo baixada e processada (só na primeira vez, ~175 MB). " +
        "Tente novamente em 1 ou 2 minutos.",
    );
  }
}

/**
 * Carrega a base sob demanda, uma única vez, sem travar o servidor.
 * Se a carga demorar mais que `timeoutMs`, a ferramenta responde pedindo para tentar de novo.
 */
export class FonteLocais {
  private promessa?: Promise<RepositorioLocais>;

  constructor(private readonly carregar: () => Promise<BaseLocais>) {}

  /** Dispara a carga em segundo plano (chamado na inicialização do servidor). */
  iniciar(): Promise<RepositorioLocais> {
    if (!this.promessa) {
      const p = this.carregar().then((base) => new RepositorioLocais(base));
      // Em caso de falha, permite nova tentativa na próxima chamada.
      p.catch(() => {
        if (this.promessa === p) this.promessa = undefined;
      });
      this.promessa = p;
    }
    return this.promessa;
  }

  async obter(timeoutMs = 20_000): Promise<RepositorioLocais> {
    let timer: NodeJS.Timeout | undefined;
    const tempoEsgotado = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new BaseEmPreparacao()), timeoutMs);
    });
    try {
      return await Promise.race([this.iniciar(), tempoEsgotado]);
    } finally {
      clearTimeout(timer);
    }
  }
}
