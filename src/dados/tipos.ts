export interface ParametrosBase {
  ano?: number;
  uf?: string;
}

/** Parâmetros já resolvidos (ano padrão aplicado, UF normalizada). */
export interface ParametrosResolvidos {
  ano?: number;
  uf?: string;
}

export interface ContextoProcessamento {
  /** Caminho do .zip baixado. */
  zip: string;
  /** Diretório onde a definição grava seus arquivos (já existe e está vazio). */
  destino: string;
  params: ParametrosResolvidos;
  /** Informa progresso do processamento (bytes descompactados lidos / total). */
  progresso: (lidos: number, total: number) => void;
  log: (msg: string) => void;
}

/**
 * Descreve uma base do Portal de Dados Abertos do TSE: de onde baixar,
 * como processar o .zip e como abrir o resultado para consulta.
 */
export interface DefinicaoBase<H = unknown> {
  /** Identificador usado nas ferramentas (ex.: "locais-votacao"). */
  id: string;
  titulo: string;
  descricao: string;
  /** Como o ano é escolhido. "eleicao" = só anos pares com eleição; "anual" = qualquer ano; "nenhum" = base única. */
  ano: "eleicao" | "anual" | "nenhum";
  /** A base é publicada separadamente por UF. */
  porUf?: boolean;
  /** UFs aceitas quando `porUf` (padrão: 27 UFs; algumas bases incluem "BR" ou "ZZ"). */
  ufs?: string[];
  url(params: ParametrosResolvidos): string;
  /** Incrementar quando o formato processado mudar (invalida o cache). */
  versao: number;
  processar(ctx: ContextoProcessamento): Promise<Record<string, unknown> | void>;
  abrir(destino: string, manifesto: Manifesto): Promise<H> | H;
}

/** Gravado em `<destino>/manifesto.json` quando a base fica pronta. */
export interface Manifesto {
  id: string;
  versao: number;
  params: ParametrosResolvidos;
  url: string;
  tamanhoDownload: number | null;
  ultimaModificacaoRemota: string | null;
  baixadaEm: string;
  tamanhoDisco: number;
  /** Metadados devolvidos por `processar` (ex.: data de geração, totais). */
  extras?: Record<string, unknown>;
}

export type Fase = "baixando" | "processando" | "pronta" | "erro";

export interface Progresso {
  base: string;
  titulo: string;
  params: ParametrosResolvidos;
  fase: Fase;
  /** Bytes baixados (fase "baixando") ou descompactados lidos (fase "processando"). */
  feito: number;
  total: number | null;
  inicioFase: number;
  inicio: number;
  erro?: string;
}
