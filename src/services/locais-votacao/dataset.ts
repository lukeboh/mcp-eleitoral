import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { parse } from "csv-parse";
import yauzl from "yauzl";
import { diretorioCache } from "../../lib/config.js";
import { parseCoordenada } from "../../lib/geo.js";
import { baixarArquivo, existe } from "../../lib/http.js";
import type { BaseLocais, LocalVotacao, MetadadosBase } from "./tipos.js";

/** Portal de Dados Abertos do TSE — "Eleitorado - Locais de votação". */
export const urlBase = (ano: number) =>
  `https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_${ano}.zip`;

/** Incrementar quando o formato do cache JSON mudar. */
const VERSAO_CACHE = 1;

type Linha = Record<string, string>;

const vazioParaNull = (v: string | undefined) => (v && v !== "-1" && !/^1+$/.test(v) ? v : null);

/**
 * Lê o CSV do TSE (latin1, ";") e agrega as seções por local de votação.
 * O arquivo repete cada seção para cada turno; só o 1º turno é considerado.
 */
export async function lerCsvLocais(entrada: Readable, fonte: string): Promise<BaseLocais> {
  const parser = entrada.pipe(
    parse({ delimiter: ";", columns: true, encoding: "latin1", bom: true, relax_quotes: true }),
  );
  const locais = new Map<string, LocalVotacao>();
  let meta: Omit<MetadadosBase, "totalLocais" | "fonte"> | undefined;

  for await (const l of parser as AsyncIterable<Linha>) {
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

/** Abre o .zip e entrega o stream do CSV nacional (*_BRASIL.csv). */
function abrirCsvNacional(caminhoZip: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(caminhoZip, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!/_BRASIL\.csv$/i.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => (e ? reject(e) : resolve(stream)));
      });
      zip.on("end", () => reject(new Error(`CSV nacional não encontrado em ${caminhoZip}`)));
      zip.readEntry();
    });
  });
}

/** Descobre o ano mais recente publicado, a partir do ano corrente. */
export async function anoMaisRecente(): Promise<number> {
  const atual = new Date().getFullYear();
  for (let ano = atual; ano >= atual - 4; ano--) {
    if (await existe(urlBase(ano))) return ano;
  }
  throw new Error("Nenhuma base de locais de votação encontrada no portal do TSE.");
}

export interface OpcoesCarga {
  ano?: number;
  /** Ignora o cache local e baixa a base novamente. */
  forcarDownload?: boolean;
  log?: (msg: string) => void;
}

/**
 * Carrega a base de locais de votação. Na primeira vez baixa o .zip do TSE
 * (~175 MB), agrega e guarda um JSON compacto no cache; depois só lê o JSON.
 */
export async function carregarBaseLocais(opcoes: OpcoesCarga = {}): Promise<BaseLocais> {
  const log = opcoes.log ?? (() => {});
  const dir = diretorioCache();
  const ano = opcoes.ano ?? (await anoMaisRecente());
  const caminhoJson = join(dir, `locais-votacao-${ano}.v${VERSAO_CACHE}.json`);

  if (!opcoes.forcarDownload && existsSync(caminhoJson)) {
    log(`Lendo base de locais de votação do cache: ${caminhoJson}`);
    return JSON.parse(await readFile(caminhoJson, "utf8")) as BaseLocais;
  }

  await mkdir(dir, { recursive: true });
  const url = urlBase(ano);
  // Nomes por processo: o cliente MCP pode iniciar mais de uma instância ao mesmo tempo.
  const caminhoZip = join(dir, `eleitorado_local_votacao_${ano}.${process.pid}.zip`);
  const caminhoTmp = `${caminhoJson}.${process.pid}.tmp`;
  log(`Baixando ${url} …`);
  try {
    await baixarArquivo(url, caminhoZip);
    log("Processando CSV …");
    const base = await lerCsvLocais(await abrirCsvNacional(caminhoZip), url);
    await writeFile(caminhoTmp, JSON.stringify(base));
    try {
      await rename(caminhoTmp, caminhoJson);
    } catch (e) {
      // Outra instância gravou a base primeiro (no Windows o arquivo pode estar em uso): mantém a dela.
      if (!existsSync(caminhoJson)) throw e;
    }
    log(`Base pronta: ${base.metadados.totalLocais} locais (${caminhoJson}).`);
    return base;
  } finally {
    await rm(caminhoZip, { force: true });
    await rm(caminhoTmp, { force: true });
  }
}
