import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { paraCadaEntrada } from "../../dados/zip.js";
import type { DefinicaoBase } from "../../dados/tipos.js";
import { lerCsvLocais, urlBase } from "./dataset.js";
import { RepositorioLocais } from "./repositorio.js";
import type { BaseLocais } from "./tipos.js";

export const baseLocaisVotacao: DefinicaoBase<RepositorioLocais> = {
  id: "locais-votacao",
  titulo: "Eleitorado - Locais de votação",
  descricao: "Todos os locais de votação do Brasil e do exterior, com endereço, coordenadas, seções e eleitores.",
  ano: "anual",
  url: ({ ano }) => urlBase(ano!),
  versao: 1,
  async processar({ zip, destino, params, progresso }) {
    let base: BaseLocais | undefined;
    await paraCadaEntrada(
      zip,
      /_BRASIL\.csv$/i,
      async (stream) => {
        base = await lerCsvLocais(stream, urlBase(params.ano!));
      },
      progresso,
    );
    await writeFile(join(destino, "locais.json"), JSON.stringify(base));
    return { ...base!.metadados };
  },
  async abrir(destino) {
    return new RepositorioLocais(JSON.parse(await readFile(join(destino, "locais.json"), "utf8")) as BaseLocais);
  },
};
