import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { lerCsvLocais } from "../src/services/locais-votacao/dataset.js";

export const CAMINHO_AMOSTRA = fileURLToPath(new URL("./fixtures/locais_votacao_amostra.csv", import.meta.url));

/** Amostra real do CSV do TSE (2026): 5 locais no DF + 3 no exterior (Nova York e Boston). */
export const carregarAmostra = () => lerCsvLocais(createReadStream(CAMINHO_AMOSTRA), "amostra");
