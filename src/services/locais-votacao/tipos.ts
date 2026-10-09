/** Um local de votação (escola, faculdade, consulado…) com todas as suas seções agregadas. */
export interface LocalVotacao {
  /** Identificador estável: UF-município-zona-local. */
  id: string;
  /** Sigla da UF. "ZZ" = exterior. */
  uf: string;
  codigoMunicipio: string;
  /** No exterior, é a cidade (ex.: "NOVA YORK"). */
  municipio: string;
  zona: number;
  /** Número do local dentro da zona (NR_LOCAL_VOTACAO). */
  numero: number;
  nome: string;
  /** "Convencional", "Preso provisório", etc. */
  tipo: string;
  endereco: string;
  bairro: string;
  cep: string | null;
  telefone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** "ATIVO", "BLOQUEADO"… */
  situacao: string;
  /** Pelo menos uma seção com acessibilidade. */
  acessivel: boolean;
  secoes: number[];
  eleitores: number;
}

export interface MetadadosBase {
  ano: number;
  dataEleicao: string;
  dataGeracao: string;
  fonte: string;
  totalLocais: number;
}

export interface BaseLocais {
  metadados: MetadadosBase;
  locais: LocalVotacao[];
}
