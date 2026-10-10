import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lerCsvTse } from "../../dados/csv.js";
import type { DefinicaoBase } from "../../dados/tipos.js";
import { paraCadaEntrada } from "../../dados/zip.js";
import { CAPITAIS_IBGE, TabelaMunicipios, type Municipio } from "./tabela.js";

/** "Rio Grande Do Norte" → "Rio Grande do Norte". */
function ajustarPreposicoes(nome: string): string {
  return nome.replace(/ (Da|De|Do|Das|Dos|E|D')(?= )/g, (m) => m.toLowerCase());
}

export const baseMunicipios: DefinicaoBase<TabelaMunicipios> = {
  id: "municipios",
  titulo: "Códigos oficiais de UF e municípios (TSE × IBGE)",
  descricao: "Todos os municípios brasileiros com códigos do TSE e do IBGE. Usada para identificar municípios nas demais bases.",
  ano: "nenhum",
  url: () => "https://cdn.tse.jus.br/estatistica/sead/odsele/municipio_tse_ibge/municipio_tse_ibge.zip",
  versao: 1,
  async processar({ zip, destino, progresso }) {
    const municipios: Municipio[] = [];
    let geracao: string | undefined;
    await paraCadaEntrada(
      zip,
      /\.csv$/i,
      async (stream) => {
        for await (const l of lerCsvTse(stream)) {
          geracao ??= l.DT_GERACAO;
          const codigoIbge = Number(l.CD_MUNICIPIO_IBGE);
          municipios.push({
            nome: ajustarPreposicoes(l.NM_MUNICIPIO_TSE),
            nomeIbge: ajustarPreposicoes(l.NM_MUNICIPIO_IBGE),
            uf: l.SG_UF,
            nomeUf: ajustarPreposicoes(l.NM_UF),
            codigoTse: l.CD_MUNICIPIO_TSE.padStart(5, "0"),
            codigoIbge,
            capital: CAPITAIS_IBGE.has(codigoIbge),
          });
        }
      },
      progresso,
    );
    await writeFile(join(destino, "municipios.json"), JSON.stringify(municipios));
    return { total: municipios.length, dataGeracao: geracao };
  },
  async abrir(destino) {
    return new TabelaMunicipios(JSON.parse(await readFile(join(destino, "municipios.json"), "utf8")) as Municipio[]);
  },
};
