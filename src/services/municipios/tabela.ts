import { normalizar } from "../../lib/texto.js";

export interface Municipio {
  nome: string;
  /** Nome segundo o IBGE (em geral igual ao do TSE). */
  nomeIbge: string;
  uf: string;
  nomeUf: string;
  /** Código do município no TSE (5 dígitos, usado em todas as bases eleitorais). */
  codigoTse: string;
  /** Código do município no IBGE (7 dígitos). */
  codigoIbge: number;
  capital: boolean;
}

/** Códigos IBGE das 27 capitais. */
export const CAPITAIS_IBGE = new Set([
  1200401, 2704302, 1600303, 1302603, 2927408, 2304400, 5300108, 3205309, 5208707,
  2111300, 5103403, 5002704, 3106200, 1501402, 2507507, 4106902, 2611606, 2211001,
  3304557, 2408102, 4314902, 1100205, 1400100, 4205407, 3550308, 2800308, 1721000,
]);

export interface ResultadoBuscaMunicipio {
  municipios: Municipio[];
  /** Como a correspondência foi feita. */
  criterio: "exato" | "prefixo" | "contem" | "aproximado" | "nenhum";
}

/** Tabela de municípios (códigos TSE × IBGE) com busca tolerante a acentos e erros de digitação. */
export class TabelaMunicipios {
  private readonly porTse = new Map<string, Municipio>();
  private readonly porIbge = new Map<number, Municipio>();
  private readonly normalizados: { m: Municipio; nome: string }[];

  constructor(readonly municipios: Municipio[]) {
    for (const m of municipios) {
      this.porTse.set(m.codigoTse, m);
      this.porIbge.set(m.codigoIbge, m);
    }
    this.normalizados = municipios.map((m) => ({ m, nome: normalizar(m.nome) }));
  }

  porCodigoTse(codigo: string | number): Municipio | undefined {
    return this.porTse.get(String(codigo).padStart(5, "0"));
  }

  porCodigoIbge(codigo: number): Municipio | undefined {
    return this.porIbge.get(codigo);
  }

  buscar(nome: string, uf?: string): ResultadoBuscaMunicipio {
    const alvo = normalizar(nome);
    const candidatos = uf ? this.normalizados.filter((c) => c.m.uf === uf.toUpperCase()) : this.normalizados;
    const tentativas: [ResultadoBuscaMunicipio["criterio"], (n: string) => boolean][] = [
      ["exato", (n) => n === alvo],
      ["prefixo", (n) => n.startsWith(alvo)],
      ["contem", (n) => n.includes(alvo)],
    ];
    for (const [criterio, casa] of tentativas) {
      const achados = candidatos.filter((c) => casa(c.nome)).map((c) => c.m);
      if (achados.length) return { municipios: ordenar(achados), criterio };
    }
    // Erros de digitação: distância de edição pequena em relação ao tamanho do nome.
    const limite = alvo.length <= 5 ? 1 : alvo.length <= 10 ? 2 : 3;
    const aproximados = candidatos
      .map((c) => ({ m: c.m, d: distancia(alvo, c.nome, limite) }))
      .filter((x) => x.d <= limite)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.m);
    return aproximados.length ? { municipios: aproximados.slice(0, 10), criterio: "aproximado" } : { municipios: [], criterio: "nenhum" };
  }
}

/** Capitais primeiro, depois por UF e nome. */
function ordenar(ms: Municipio[]): Municipio[] {
  return [...ms].sort((a, b) => Number(b.capital) - Number(a.capital) || a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome));
}

/** Levenshtein com corte: devolve limite+1 assim que ultrapassa o limite. */
function distancia(a: string, b: string, limite: number): number {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      minimo = Math.min(minimo, atual[j]);
    }
    if (minimo > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length];
}
