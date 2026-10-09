import { normalizar } from "../../lib/texto.js";

/** Sigla usada pelo TSE para o exterior. */
export const UF_EXTERIOR = "ZZ";

const NOMES_UF: Record<string, string> = {
  AC: "ACRE", AL: "ALAGOAS", AP: "AMAPA", AM: "AMAZONAS", BA: "BAHIA", CE: "CEARA",
  DF: "DISTRITO FEDERAL", ES: "ESPIRITO SANTO", GO: "GOIAS", MA: "MARANHAO",
  MT: "MATO GROSSO", MS: "MATO GROSSO DO SUL", MG: "MINAS GERAIS", PA: "PARA",
  PB: "PARAIBA", PR: "PARANA", PE: "PERNAMBUCO", PI: "PIAUI", RJ: "RIO DE JANEIRO",
  RN: "RIO GRANDE DO NORTE", RS: "RIO GRANDE DO SUL", RO: "RONDONIA", RR: "RORAIMA",
  SC: "SANTA CATARINA", SP: "SAO PAULO", SE: "SERGIPE", TO: "TOCANTINS",
  [UF_EXTERIOR]: "EXTERIOR",
};

const UF_POR_NOME = new Map(Object.entries(NOMES_UF).map(([sigla, nome]) => [nome, sigla]));

/** Aceita sigla ("df"), nome ("Distrito Federal") ou "exterior". */
export function resolverUf(entrada: string): string | undefined {
  const n = normalizar(entrada);
  if (n in NOMES_UF) return n;
  return UF_POR_NOME.get(n);
}

/**
 * O TSE grava cidades do exterior em português ("NOVA YORK", "TÓQUIO").
 * Apelidos comuns → nome usado pelo TSE (já normalizado).
 */
const APELIDOS_MUNICIPIO: Record<string, string> = {
  "NY": "NOVA YORK",
  "NYC": "NOVA YORK",
  "NEW YORK": "NOVA YORK",
  "NEW YORK CITY": "NOVA YORK",
  "NOVA IORQUE": "NOVA YORK",
  "TOKYO": "TOQUIO",
  "LONDON": "LONDRES",
  "LISBON": "LISBOA",
  "MILAN": "MILAO",
  "MILANO": "MILAO",
  "MADRID": "MADRI",
  "ROME": "ROMA",
  "NAGOYA": "NAGOIA",
  "LA": "LOS ANGELES",
  "BSB": "BRASILIA",
  "SAMPA": "SAO PAULO",
};

export function normalizarMunicipio(entrada: string): string {
  const n = normalizar(entrada);
  return APELIDOS_MUNICIPIO[n] ?? n;
}
