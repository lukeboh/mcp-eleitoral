import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatarBytes, formatarDuracao } from "./formato.js";
import { baixar, infoRemota, type InfoRemota } from "./rede.js";
import type { DefinicaoBase, Manifesto, ParametrosBase, ParametrosResolvidos, Progresso } from "./tipos.js";

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/** Erro devolvido às ferramentas quando a base precisa ser baixada antes. */
export class BaseNaoBaixada extends Error {
  constructor(
    readonly base: string,
    readonly params: ParametrosResolvidos,
    readonly tamanho: number | null,
    titulo: string,
  ) {
    const p = descreverParams(params);
    super(
      `Esta consulta precisa da base "${titulo}"${p ? ` (${p})` : ""}, que ainda não foi baixada. ` +
        `Download: ${formatarBytes(tamanho)}. ` +
        `Informe o tamanho ao usuário e peça confirmação; se ele concordar, chame a ferramenta \`baixar_base\` ` +
        `com base="${base}"${params.ano ? `, ano=${params.ano}` : ""}${params.uf ? `, uf="${params.uf}"` : ""}. ` +
        "O progresso pode ser acompanhado com `progresso_downloads`.",
    );
  }
}

/** Erro devolvido enquanto a base está sendo baixada/processada. */
export class BaseEmPreparacao extends Error {
  constructor(readonly progresso: Progresso) {
    super(`A base "${progresso.titulo}" está sendo preparada: ${descreverProgresso(progresso)}. Tente novamente quando terminar (acompanhe com \`progresso_downloads\`).`);
  }
}

export function descreverParams(p: ParametrosResolvidos): string {
  return [p.ano && `ano ${p.ano}`, p.uf && `UF ${p.uf}`].filter(Boolean).join(", ");
}

export function descreverProgresso(p: Progresso): string {
  if (p.fase === "erro") return `falhou: ${p.erro}`;
  if (p.fase === "pronta") return `pronta (em ${formatarDuracao((Date.now() - p.inicio) / 1000)})`;
  const pct = p.total ? Math.min(100, (p.feito / p.total) * 100) : null;
  const decorrido = (Date.now() - p.inicioFase) / 1000;
  const taxa = decorrido > 0 ? p.feito / decorrido : 0;
  const restante = p.total && taxa > 0 ? (p.total - p.feito) / taxa : NaN;
  const acao = p.fase === "baixando" ? "baixando" : "processando";
  return (
    `${acao} ${pct !== null ? `${pct.toFixed(0)}%` : ""} (${formatarBytes(p.feito)} de ${formatarBytes(p.total)}` +
    (taxa > 0 ? `, ${formatarBytes(taxa)}/s` : "") +
    (Number.isFinite(restante) ? `, faltam ~${formatarDuracao(restante)}` : "") +
    ")" +
    (p.fase === "baixando" ? " — depois vem o processamento" : "")
  );
}

export interface OpcoesGerenciador {
  diretorio: string;
  /** Bases até este tamanho são baixadas sem pedir confirmação. Padrão: 10 MB. */
  limiteAutomaticoBytes?: number;
  /** Troca a URL de origem (útil em testes: file://). */
  url?: (def: DefinicaoBase, params: ParametrosResolvidos) => string | undefined;
  log?: (msg: string) => void;
  /** Ano corrente, para escolher o ano padrão (padrão: relógio do sistema). */
  anoAtual?: number;
}

export interface InfoBase {
  base: string;
  titulo: string;
  descricao: string;
  params: ParametrosResolvidos;
  url: string;
  tamanho_download: string;
  tamanho_download_bytes: number | null;
  disponivel_no_tse: boolean;
  situacao: "nao_baixada" | "baixando" | "processando" | "pronta" | "erro";
  progresso?: string;
  tamanho_em_disco?: string;
  baixada_em?: string;
  atualizacao_disponivel?: boolean;
}

/**
 * Coordena download, processamento e abertura das bases do TSE.
 * Emite "progresso" (Progresso) durante downloads.
 */
export class GerenciadorBases extends EventEmitter {
  private readonly definicoes = new Map<string, DefinicaoBase>();
  private readonly abertas = new Map<string, Promise<unknown>>();
  private readonly tarefas = new Map<string, { progresso: Progresso; promessa: Promise<void> }>();
  private readonly anosPadrao = new Map<string, Promise<number>>();
  private readonly infos = new Map<string, Promise<InfoRemota>>();
  private readonly log: (msg: string) => void;
  readonly limiteAutomatico: number;

  constructor(
    definicoes: DefinicaoBase[],
    private readonly opcoes: OpcoesGerenciador,
  ) {
    super();
    for (const d of definicoes) this.definicoes.set(d.id, d);
    this.log = opcoes.log ?? (() => {});
    this.limiteAutomatico = opcoes.limiteAutomaticoBytes ?? 10 * 1024 * 1024;
  }

  listarDefinicoes(): DefinicaoBase[] {
    return [...this.definicoes.values()];
  }

  definicao(id: string): DefinicaoBase {
    const d = this.definicoes.get(id);
    if (!d) throw new Error(`Base desconhecida: "${id}". Bases disponíveis: ${[...this.definicoes.keys()].join(", ")}.`);
    return d;
  }

  url(def: DefinicaoBase, p: ParametrosResolvidos): string {
    return this.opcoes.url?.(def, p) ?? def.url(p);
  }

  /** Aplica ano padrão (mais recente publicado) e valida a UF. */
  async resolver(id: string, params: ParametrosBase = {}): Promise<ParametrosResolvidos> {
    const def = this.definicao(id);
    const r: ParametrosResolvidos = {};
    if (def.porUf) {
      if (!params.uf) throw new Error(`A base "${def.titulo}" é publicada por UF: informe \`uf\`.`);
      const uf = params.uf.trim().toUpperCase();
      const validas = def.ufs ?? UFS;
      if (!validas.includes(uf)) throw new Error(`UF inválida para "${def.titulo}": ${params.uf}. Use: ${validas.join(", ")}.`);
      r.uf = uf;
    }
    if (def.ano !== "nenhum") {
      if (params.ano) {
        if (def.ano === "eleicao" && params.ano % 2 !== 0) throw new Error(`Não houve eleição em ${params.ano} (eleições ocorrem em anos pares).`);
        r.ano = params.ano;
      } else {
        r.ano = await this.anoPadrao(def, r.uf);
      }
    }
    return r;
  }

  private anoPadrao(def: DefinicaoBase, uf?: string): Promise<number> {
    const chave = def.id;
    let p = this.anosPadrao.get(chave);
    if (!p) {
      p = (async () => {
        const atual = this.opcoes.anoAtual ?? new Date().getFullYear();
        const passo = def.ano === "eleicao" ? 2 : 1;
        const inicio = def.ano === "eleicao" && atual % 2 !== 0 ? atual - 1 : atual;
        for (let ano = inicio; ano >= atual - 8; ano -= passo) {
          // Base já em cache conta como disponível (funciona offline).
          if (existsSync(join(this.diretorioInstancia(def, { ano, uf }), "manifesto.json"))) return ano;
          if ((await this.info(def, { ano, uf })).existe) return ano;
        }
        throw new Error(`Nenhum ano disponível para "${def.titulo}" no portal do TSE.`);
      })();
      p.catch(() => this.anosPadrao.delete(chave));
      this.anosPadrao.set(chave, p);
    }
    return p;
  }

  private info(def: DefinicaoBase, p: ParametrosResolvidos): Promise<InfoRemota> {
    const url = this.url(def, p);
    let i = this.infos.get(url);
    if (!i) {
      i = infoRemota(url).catch(() => ({ existe: false, tamanho: null, ultimaModificacao: null }));
      this.infos.set(url, i);
      // Revalida depois de 10 minutos.
      setTimeout(() => this.infos.delete(url), 10 * 60_000).unref();
    }
    return i;
  }

  chave(id: string, p: ParametrosResolvidos): string {
    return [id, p.ano ?? "unica", p.uf].filter(Boolean).join(":");
  }

  diretorioInstancia(def: DefinicaoBase, p: ParametrosResolvidos): string {
    return join(this.opcoes.diretorio, def.id, [p.ano ?? "unica", p.uf].filter(Boolean).join("-"));
  }

  private async manifesto(def: DefinicaoBase, p: ParametrosResolvidos): Promise<Manifesto | null> {
    const caminho = join(this.diretorioInstancia(def, p), "manifesto.json");
    if (!existsSync(caminho)) return null;
    const m = JSON.parse(await readFile(caminho, "utf8")) as Manifesto;
    return m.versao === def.versao ? m : null;
  }

  /** Situação da base, incluindo tamanho do download (HEAD no TSE). */
  async informacoes(id: string, params: ParametrosBase = {}): Promise<InfoBase> {
    const def = this.definicao(id);
    const p = await this.resolver(id, params);
    const [remota, manifesto] = await Promise.all([this.info(def, p), this.manifesto(def, p)]);
    const tarefa = this.tarefas.get(this.chave(id, p));
    const info: InfoBase = {
      base: id,
      titulo: def.titulo,
      descricao: def.descricao,
      params: p,
      url: this.url(def, p),
      tamanho_download: formatarBytes(remota.tamanho),
      tamanho_download_bytes: remota.tamanho,
      disponivel_no_tse: remota.existe,
      situacao: "nao_baixada",
    };
    if (tarefa && tarefa.progresso.fase !== "pronta") {
      info.situacao = tarefa.progresso.fase;
      info.progresso = descreverProgresso(tarefa.progresso);
    } else if (manifesto) {
      info.situacao = "pronta";
      info.tamanho_em_disco = formatarBytes(manifesto.tamanhoDisco);
      info.baixada_em = manifesto.baixadaEm;
      if (remota.ultimaModificacao && manifesto.ultimaModificacaoRemota) {
        info.atualizacao_disponivel =
          new Date(remota.ultimaModificacao).getTime() > new Date(manifesto.ultimaModificacaoRemota).getTime();
      }
    }
    return info;
  }

  /** Bases já baixadas (lendo os manifestos do disco). */
  async baixadas(): Promise<Manifesto[]> {
    const res: Manifesto[] = [];
    for (const def of this.definicoes.values()) {
      const dir = join(this.opcoes.diretorio, def.id);
      if (!existsSync(dir)) continue;
      for (const sub of await readdir(dir)) {
        const caminho = join(dir, sub, "manifesto.json");
        if (!existsSync(caminho)) continue;
        const m = JSON.parse(await readFile(caminho, "utf8")) as Manifesto;
        if (m.versao === def.versao) res.push(m);
      }
    }
    return res;
  }

  progressos(): Progresso[] {
    return [...this.tarefas.values()].map((t) => t.progresso);
  }

  /**
   * Inicia (ou reaproveita) o download + processamento em segundo plano.
   * Retorna a promessa de conclusão.
   */
  async iniciarDownload(id: string, params: ParametrosBase = {}, opcoes: { forcar?: boolean } = {}) {
    const def = this.definicao(id);
    const p = await this.resolver(id, params);
    const chave = this.chave(id, p);
    const existente = this.tarefas.get(chave);
    if (existente && (existente.progresso.fase === "baixando" || existente.progresso.fase === "processando")) {
      return { progresso: existente.progresso, promessa: existente.promessa, jaEmAndamento: true };
    }
    if (!opcoes.forcar && (await this.manifesto(def, p))) {
      return { progresso: undefined, promessa: Promise.resolve(), jaPronta: true };
    }

    const agora = Date.now();
    const progresso: Progresso = {
      base: id,
      titulo: def.titulo,
      params: p,
      fase: "baixando",
      feito: 0,
      total: null,
      inicio: agora,
      inicioFase: agora,
    };
    const promessa = this.executar(def, p, progresso, !!opcoes.forcar);
    promessa.catch(() => {}); // erro fica registrado no progresso
    this.tarefas.set(chave, { progresso, promessa });
    return { progresso, promessa, jaEmAndamento: false };
  }

  private async executar(def: DefinicaoBase, p: ParametrosResolvidos, prog: Progresso, forcar: boolean): Promise<void> {
    const destino = this.diretorioInstancia(def, p);
    // Nomes por processo: o cliente MCP pode iniciar mais de uma instância do servidor ao mesmo tempo.
    const sufixo = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const temporario = `${destino}.${sufixo}.tmp`;
    const zip = `${destino}.${sufixo}.zip`;
    const url = this.url(def, p);
    const rotulo = `${def.titulo}${descreverParams(p) ? ` (${descreverParams(p)})` : ""}`;
    let ultimoLog = 0;
    const emitir = () => {
      this.emit("progresso", prog);
      const marco = prog.total ? Math.floor((prog.feito / prog.total) * 10) : 0;
      if (marco !== ultimoLog) {
        ultimoLog = marco;
        this.log(`${rotulo}: ${descreverProgresso(prog)}`);
      }
    };
    try {
      const remota = await this.info(def, p);
      if (!remota.existe) throw new Error(`Arquivo não encontrado no TSE: ${url}`);
      this.log(`${rotulo}: baixando ${formatarBytes(remota.tamanho)} de ${url}`);
      prog.total = remota.tamanho;
      await baixar(url, zip, (feito, total) => {
        prog.feito = feito;
        prog.total = total ?? prog.total;
        emitir();
      });

      prog.fase = "processando";
      prog.feito = 0;
      prog.total = null;
      prog.inicioFase = Date.now();
      ultimoLog = 0;
      emitir();
      await rm(temporario, { recursive: true, force: true });
      await mkdir(temporario, { recursive: true });
      const extras = await def.processar({
        zip,
        destino: temporario,
        params: p,
        progresso: (lidos, total) => {
          prog.feito = lidos;
          prog.total = total;
          emitir();
        },
        log: (m) => this.log(`${rotulo}: ${m}`),
      });

      const manifesto: Manifesto = {
        id: def.id,
        versao: def.versao,
        params: p,
        url,
        tamanhoDownload: remota.tamanho,
        ultimaModificacaoRemota: remota.ultimaModificacao,
        baixadaEm: new Date().toISOString(),
        tamanhoDisco: await tamanhoDiretorio(temporario),
        extras: extras ?? undefined,
      };
      await writeFile(join(temporario, "manifesto.json"), JSON.stringify(manifesto, null, 2));

      await this.instalar(def, p, temporario, destino, forcar);
      prog.fase = "pronta";
      emitir();
      this.log(`${rotulo}: pronta (${formatarBytes(manifesto.tamanhoDisco)} em disco).`);
    } catch (e) {
      prog.fase = "erro";
      prog.erro = e instanceof Error ? e.message : String(e);
      this.emit("progresso", prog);
      this.log(`${rotulo}: erro — ${prog.erro}`);
      await rm(temporario, { recursive: true, force: true });
      throw e;
    } finally {
      await rm(zip, { force: true });
      await rm(`${zip}.part`, { force: true });
    }
  }

  /** Move a base processada para o lugar definitivo, substituindo a anterior quando é atualização. */
  private async instalar(def: DefinicaoBase, p: ParametrosResolvidos, temporario: string, destino: string, forcar: boolean) {
    const jaExiste = existsSync(join(destino, "manifesto.json"));
    if (jaExiste && !forcar) {
      // Outra instância terminou primeiro: mantém a dela.
      await rm(temporario, { recursive: true, force: true });
      return;
    }
    await this.fecharAberta(this.chave(def.id, p));
    try {
      await rm(destino, { recursive: true, force: true });
      await rename(temporario, destino);
    } catch (e) {
      // No Windows o diretório pode estar em uso por outra instância: mantém a versão existente.
      if (!existsSync(join(destino, "manifesto.json"))) throw e;
      await rm(temporario, { recursive: true, force: true });
    }
  }

  private async fecharAberta(chave: string) {
    const aberta = this.abertas.get(chave);
    this.abertas.delete(chave);
    if (aberta) {
      const h = (await aberta.catch(() => null)) as { fechar?: () => void } | null;
      h?.fechar?.();
    }
  }

  /**
   * Devolve a base aberta para consulta. Se não estiver baixada:
   * - pequena (≤ limite automático): baixa agora e espera;
   * - grande: lança BaseNaoBaixada (com o tamanho) para o usuário confirmar.
   */
  async obter<H>(id: string, params: ParametrosBase = {}): Promise<H> {
    const def = this.definicao(id);
    const p = await this.resolver(id, params);
    const chave = this.chave(id, p);
    const aberta = this.abertas.get(chave);
    if (aberta) return aberta as Promise<H>;

    const tarefa = this.tarefas.get(chave);
    if (tarefa && (tarefa.progresso.fase === "baixando" || tarefa.progresso.fase === "processando")) {
      throw new BaseEmPreparacao(tarefa.progresso);
    }

    let manifesto = await this.manifesto(def, p);
    if (!manifesto) {
      const remota = await this.info(def, p);
      if (!remota.existe) {
        throw new Error(`A base "${def.titulo}" (${descreverParams(p) || "única"}) não está publicada no portal do TSE.`);
      }
      if (remota.tamanho !== null && remota.tamanho <= this.limiteAutomatico) {
        const { promessa } = await this.iniciarDownload(id, p);
        await promessa;
        manifesto = await this.manifesto(def, p);
      }
      if (!manifesto) throw new BaseNaoBaixada(id, p, remota.tamanho, def.titulo);
    }

    const m = manifesto;
    const promessa = Promise.resolve(def.abrir(this.diretorioInstancia(def, p), m));
    promessa.catch(() => this.abertas.delete(chave));
    this.abertas.set(chave, promessa);
    return promessa as Promise<H>;
  }

  async remover(id: string, params: ParametrosBase = {}): Promise<boolean> {
    const def = this.definicao(id);
    const p = await this.resolver(id, params);
    const chave = this.chave(id, p);
    const t = this.tarefas.get(chave);
    if (t && (t.progresso.fase === "baixando" || t.progresso.fase === "processando")) {
      throw new Error("Não é possível remover uma base enquanto ela está sendo baixada.");
    }
    await this.fecharAberta(chave);
    const dir = this.diretorioInstancia(def, p);
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    this.tarefas.delete(chave);
    return true;
  }
}

async function tamanhoDiretorio(dir: string): Promise<number> {
  let total = 0;
  for (const nome of await readdir(dir)) {
    const s = await stat(join(dir, nome));
    total += s.isDirectory() ? await tamanhoDiretorio(join(dir, nome)) : s.size;
  }
  return total;
}
