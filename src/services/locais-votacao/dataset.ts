import type { Readable } from "node:stream";
import { lerCsvTse } from "../../dados/csv.js";
import { parseCoordenada } from "../../lib/geo.js";
import type { BaseLocais, LocalVotacao, MetadadosBase } from "./tipos.js";

/** Portal de Dados Abertos do TSE — "Eleitorado - Locais de votação". */
export const urlBase = (ano: number) =>
  `https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip`;

const vazioParaNull = (v: string | undefined) => (v && v !== "-1" && !/^1+$/.test(v) ? v : null);

/**
 * Lê o CSV do TSE (latin1, ";") e agrega as seções por local de votação.
 * O arquivo repete cada seção para cada turno; só o 1º turno é considerado.
 */
export async function lerCsvLocais(entrada: Readable, fonte: string): Promise<BaseLocais> {
  const locais = new Map<string, LocalVotacao>();
  let meta: Omit<MetadadosBase, "totalLocais" | "fonte"> | undefined;

  for await (const l of lerCsvTse(entrada)) {
    if (l.NR_TURNO !== "1") continue;
    meta ??= { ano: Number(l.AA_ELEICAO), dataEleicao: l.DT_ELEICAO, dataGeracao: l.DT_GERACAO };

    const id = `${l.SG_UF}-${l.CD_MUNICIPIO}-${l.NR_ZONA}-${l.NR_LOCAL_VOTACAO}`;
    let local = locais.get(id);
    if (!local) {
      local = {
        id,
        uf: l.SG_UF,
        codigoMunicipio: l.CD_MUNICIPIO,
        municipio: l.NM_MUNICIPIO,
        zona: Number(l.NR_ZONA),
        numero: Number(l.NR_LOCAL_VOTACAO),
        nome: l.NM_LOCAL_VOTACAO,
        tipo: l.DS_TIPO_LOCAL,
        endereco: l.DS_ENDERECO,
        bairro: l.NM_BAIRRO,
        cep: vazioParaNull(l.NR_CEP),
        telefone: vazioParaNull(l.NR_TELEFONE_LOCAL),
        latitude: parseCoordenada(l.NR_LATITUDE),
        longitude: parseCoordenada(l.NR_LONGITUDE),
        situacao: l.DS_SITU_LOCAL_VOTACAO,
        acessivel: false,
        secoes: [],
        eleitores: 0,
      };
      locais.set(id, local);
    }
    local.secoes.push(Number(l.NR_SECAO));
    local.eleitores += Number(l.QT_ELEITOR_SECAO) || 0;
    if (l.CD_SITU_SECAO_ACESSIBILIDADE === "1") local.acessivel = true;
  }

  if (!meta) throw new Error("CSV de locais de votação vazio ou em formato inesperado.");
  for (const local of locais.values()) local.secoes.sort((a, b) => a - b);
  return { metadados: { ...meta, fonte, totalLocais: locais.size }, locais: [...locais.values()] };
}
