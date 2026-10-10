import { join } from "node:path";
import type { LinhaCsv } from "../../dados/csv.js";
import { UFS } from "../../dados/gerenciador.js";
import { abrirSomenteLeitura, col, criarIndices, criarTabela, importarCsv, novoBanco, type DatabaseSync, type Tabela } from "../../dados/sqlite.js";
import type { DefinicaoBase } from "../../dados/tipos.js";
import { paraCadaEntrada } from "../../dados/zip.js";
import { normalizar } from "../../lib/texto.js";

const CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele";

/** Base aberta como SQLite, com `fechar` para o gerenciador liberar o arquivo. */
export interface BancoResultados {
  db: DatabaseSync;
  extras: Record<string, unknown>;
  fechar(): void;
}

function abrirBanco(destino: string, extras: Record<string, unknown> | undefined): BancoResultados {
  const db = abrirSomenteLeitura(join(destino, "dados.sqlite"));
  return { db, extras: extras ?? {}, fechar: () => db.close() };
}

/** Colunas comuns de local (UF/município/zona) com nome normalizado para busca sem acento. */
const colunasLocal = [
  col.inteiro("turno", "NR_TURNO"),
  col.texto("uf", "SG_UF"),
  col.texto("cd_municipio", "CD_MUNICIPIO", (v) => (v ? v.padStart(5, "0") : null)),
  col.texto("nm_municipio", "NM_MUNICIPIO"),
  { nome: "nm_municipio_norm", tipo: "TEXT" as const, valor: (l: LinhaCsv) => normalizar(l.NM_MUNICIPIO ?? "") },
  col.inteiro("zona", "NR_ZONA"),
  col.inteiro("cd_cargo", "CD_CARGO"),
  col.texto("ds_cargo", "DS_CARGO"),
];

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Processa entradas do zip para tabelas SQLite e grava `dados.sqlite`. */
async function importar(
  zip: string,
  destino: string,
  progresso: (lidos: number, total: number) => void,
  entradas: { filtro: RegExp; tabela: Tabela; aoLer?: (l: LinhaCsv) => void }[],
  aposImportar?: (db: DatabaseSync) => void,
) {
  const db = novoBanco(join(destino, "dados.sqlite"));
  const contagens: Record<string, number> = {};
  try {
    for (const e of entradas) criarTabela(db, e.tabela);
    // Progresso em bytes descompactados, acumulado entre as entradas.
    let jaLidos = 0;
    for (const e of entradas) {
      const tabela = e.aoLer ? { ...e.tabela, filtro: (l: LinhaCsv) => (e.aoLer!(l), e.tabela.filtro ? e.tabela.filtro(l) : true) } : e.tabela;
      await paraCadaEntrada(
        zip,
        e.filtro,
        async (stream) => {
          contagens[e.tabela.nome] = (contagens[e.tabela.nome] ?? 0) + (await importarCsv(db, tabela, stream));
        },
        (lidos, total) => progresso(jaLidos + lidos, jaLidos + total),
      ).then((es) => (jaLidos += es.reduce((s, x) => s + x.tamanho, 0)));
    }
    aposImportar?.(db);
    for (const e of entradas) criarIndices(db, e.tabela);
    db.exec("ANALYZE");
  } finally {
    db.close();
  }
  return contagens;
}

// ---------------------------------------------------------------------------
// Detalhe da votação por município/zona: comparecimento, abstenção, brancos, nulos.

export const tabelaDetalhe: Tabela = {
  nome: "detalhe",
  colunas: [
    ...colunasLocal,
    col.texto("ds_eleicao", "DS_ELEICAO"),
    col.texto("dt_eleicao", "DT_ELEICAO"),
    col.inteiro("aptos", "QT_APTOS"),
    col.inteiro("secoes", "QT_TOTAL_SECOES"),
    col.inteiro("comparecimento", "QT_COMPARECIMENTO"),
    col.inteiro("abstencoes", "QT_ABSTENCOES"),
    col.inteiro("votos_validos", "QT_TOTAL_VOTOS_VALIDOS"),
    col.inteiro("votos_nominais", "QT_VOTOS_NOMINAIS_VALIDOS"),
    col.inteiro("votos_legenda", "QT_TOTAL_VOTOS_LEG_VALIDOS"),
    col.inteiro("votos_brancos", "QT_VOTOS_BRANCOS"),
    col.inteiro("votos_nulos", "QT_TOTAL_VOTOS_NULOS"),
    col.inteiro("votos_anulados", "QT_TOTAL_VOTOS_ANULADOS"),
    col.texto("totalizado_em", "DT_ULTIMA_TOTALIZACAO"),
  ],
  indices: [["cd_cargo", "turno", "uf"]],
};

export const baseResultadosDetalhe: DefinicaoBase<BancoResultados> = {
  id: "resultados-detalhe",
  titulo: "Resultados - Detalhe da votação por município e zona",
  descricao: "Eleitores aptos, comparecimento, abstenção, votos válidos, brancos e nulos por cargo, município e zona.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/detalhe_votacao_munzona/detalhe_votacao_munzona_${ano}.zip`,
  versao: 1,
  async processar({ zip, destino, progresso }) {
    const linhas = await importar(zip, destino, progresso, [{ filtro: /_BRASIL\.csv$/i, tabela: tabelaDetalhe }]);
    return { linhas };
  },
  abrir: (destino, m) => abrirBanco(destino, m.extras),
};

// ---------------------------------------------------------------------------
// Votação por candidato e por município/zona.

export const tabelaCandidatos: Tabela = {
  nome: "candidatos",
  colunas: [
    col.inteiro("sq_candidato", "SQ_CANDIDATO"),
    col.inteiro("turno", "NR_TURNO"),
    col.texto("uf", "SG_UE"),
    col.inteiro("cd_cargo", "CD_CARGO"),
    col.texto("ds_cargo", "DS_CARGO"),
    col.inteiro("numero", "NR_CANDIDATO"),
    col.texto("nome", "NM_CANDIDATO"),
    col.texto("nome_urna", "NM_URNA_CANDIDATO"),
    { nome: "nome_norm", tipo: "TEXT", valor: (l) => `${normalizar(l.NM_URNA_CANDIDATO ?? "")} | ${normalizar(l.NM_CANDIDATO ?? "")}` },
    col.texto("partido", "SG_PARTIDO"),
    col.inteiro("nr_partido", "NR_PARTIDO"),
    col.texto("federacao", "NM_FEDERACAO", (v) => (v && !v.startsWith("#") ? v : null)),
    col.texto("coligacao", "NM_COLIGACAO"),
    col.texto("composicao", "DS_COMPOSICAO_COLIGACAO"),
    col.texto("situacao_candidatura", "DS_SITUACAO_CANDIDATURA"),
    col.texto("situacao", "DS_SIT_TOT_TURNO"),
  ],
  indices: [["sq_candidato", "turno"], ["cd_cargo", "uf", "turno"]],
};

export const tabelaVotos: Tabela = {
  nome: "votos",
  colunas: [
    col.inteiro("sq_candidato", "SQ_CANDIDATO"),
    ...colunasLocal.filter((c) => c.nome !== "ds_cargo"),
    { nome: "votos", tipo: "INTEGER", valor: (l) => num(l.QT_VOTOS_NOMINAIS_VALIDOS) },
  ],
  // Só guarda onde houve voto: o arquivo traz cada candidato em cada município/zona, inclusive com zero.
  filtro: (l) => num(l.QT_VOTOS_NOMINAIS_VALIDOS) > 0,
  indices: [["sq_candidato", "turno"], ["cd_cargo", "turno", "uf"], ["cd_municipio", "cd_cargo", "turno"]],
};

export const baseResultadosCandidatos: DefinicaoBase<BancoResultados> = {
  id: "resultados-candidatos",
  titulo: "Resultados - Votação por candidato, município e zona",
  descricao:
    "Votos de cada candidato em cada município e zona, com partido, coligação e situação (eleito, 2º turno, suplente…). " +
    "Arquivo grande: o processamento leva alguns minutos.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`,
  versao: 2,
  async processar({ zip, destino, progresso }) {
    const vistos = new Set<string>();
    const fichas: LinhaCsv[] = [];
    const linhas = await importar(zip, destino, progresso, [
      {
        filtro: /_BRASIL\.csv$/i,
        tabela: tabelaVotos,
        // Na mesma leitura, guarda a ficha de cada candidato (uma por turno) numa tabela à parte.
        aoLer: (l) => {
          const chave = `${l.SQ_CANDIDATO}-${l.NR_TURNO}`;
          if (vistos.has(chave)) return;
          vistos.add(chave);
          fichas.push(l);
        },
      },
    ], (db) => {
      criarTabela(db, tabelaCandidatos);
      const stmt = db.prepare(
        `INSERT INTO candidatos (${tabelaCandidatos.colunas.map((c) => c.nome).join(", ")}) VALUES (${tabelaCandidatos.colunas.map(() => "?").join(", ")})`,
      );
      db.exec("BEGIN");
      for (const l of fichas) stmt.run(...tabelaCandidatos.colunas.map((c) => c.valor(l)));
      db.exec("COMMIT");
      criarIndices(db, tabelaCandidatos);
    });
    return { linhas: { ...linhas, candidatos: fichas.length } };
  },
  abrir: (destino, m) => abrirBanco(destino, m.extras),
};

// ---------------------------------------------------------------------------
// Votação por partido (nominal + legenda) por município/zona — cargos proporcionais.

export const tabelaPartidos: Tabela = {
  nome: "partidos",
  colunas: [
    ...colunasLocal,
    col.texto("partido", "SG_PARTIDO"),
    col.inteiro("nr_partido", "NR_PARTIDO"),
    col.texto("federacao", "SG_FEDERACAO", (v) => (v && !v.startsWith("#") ? v : null)),
    { nome: "votos_nominais", tipo: "INTEGER", valor: (l) => num(l.QT_VOTOS_NOMINAIS_VALIDOS) },
    { nome: "votos_legenda", tipo: "INTEGER", valor: (l) => num(l.QT_TOTAL_VOTOS_LEG_VALIDOS) },
  ],
  filtro: (l) => num(l.QT_VOTOS_NOMINAIS_VALIDOS) + num(l.QT_TOTAL_VOTOS_LEG_VALIDOS) > 0,
  indices: [["cd_cargo", "turno", "uf"]],
};

export const baseResultadosPartidos: DefinicaoBase<BancoResultados> = {
  id: "resultados-partidos",
  titulo: "Resultados - Votação por partido, município e zona",
  descricao: "Votos nominais e de legenda de cada partido/federação por município e zona (cargos proporcionais).",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/votacao_partido_munzona/votacao_partido_munzona_${ano}.zip`,
  versao: 1,
  async processar({ zip, destino, progresso }) {
    return { linhas: await importar(zip, destino, progresso, [{ filtro: /_BRASIL\.csv$/i, tabela: tabelaPartidos }]) };
  },
  abrir: (destino, m) => abrirBanco(destino, m.extras),
};

// ---------------------------------------------------------------------------
// Votação por seção eleitoral (por UF; "BR" = presidente em todo o país; "ZZ" = exterior).

export const tabelaSecao: Tabela = {
  nome: "secao",
  colunas: [
    col.inteiro("turno", "NR_TURNO"),
    col.texto("uf", "SG_UF"),
    col.texto("cd_municipio", "CD_MUNICIPIO", (v) => (v ? v.padStart(5, "0") : null)),
    col.inteiro("zona", "NR_ZONA"),
    col.inteiro("secao", "NR_SECAO"),
    col.inteiro("nr_local", "NR_LOCAL_VOTACAO"),
    col.inteiro("cd_cargo", "CD_CARGO"),
    col.inteiro("nr_votavel", "NR_VOTAVEL"),
    col.inteiro("votos", "QT_VOTOS"),
  ],
  indices: [["zona", "nr_local"], ["zona", "secao"], ["cd_municipio", "cd_cargo"]],
};

export const baseVotacaoSecao: DefinicaoBase<BancoResultados> = {
  id: "votacao-secao",
  titulo: "Resultados - Votação por seção eleitoral",
  descricao:
    'Votos de cada candidato (e brancos/nulos) em cada seção e local de votação de uma UF. Use uf="BR" para presidente ' +
    '(o arquivo de cada UF traz só os cargos estaduais) e "ZZ" para o exterior.',
  ano: "eleicao",
  porUf: true,
  ufs: [...UFS, "BR", "ZZ"],
  url: ({ ano, uf }) => `${CDN}/votacao_secao/votacao_secao_${ano}_${uf}.zip`,
  versao: 1,
  async processar({ zip, destino, progresso }) {
    // Nomes de candidatos e de locais se repetem em milhares de linhas: ficam em tabelas próprias.
    const votaveis = new Map<string, [number, number, string, number | null, string]>();
    const locais = new Map<string, [string, string, string, number, number, string, string]>();
    const linhas = await importar(zip, destino, progresso, [
      {
        filtro: /\.csv$/i,
        tabela: tabelaSecao,
        aoLer: (l) => {
          const kv = `${l.CD_CARGO}-${l.NR_VOTAVEL}`;
          if (!votaveis.has(kv)) {
            votaveis.set(kv, [Number(l.CD_CARGO), Number(l.NR_VOTAVEL), l.NM_VOTAVEL, Number(l.SQ_CANDIDATO) > 0 ? Number(l.SQ_CANDIDATO) : null, l.DS_CARGO]);
          }
          const kl = `${l.CD_MUNICIPIO}-${l.NR_ZONA}-${l.NR_LOCAL_VOTACAO}`;
          if (!locais.has(kl)) {
            locais.set(kl, [l.SG_UF, l.CD_MUNICIPIO.padStart(5, "0"), l.NM_MUNICIPIO, Number(l.NR_ZONA), Number(l.NR_LOCAL_VOTACAO), l.NM_LOCAL_VOTACAO, l.DS_LOCAL_VOTACAO_ENDERECO]);
          }
        },
      },
    ], (db) => {
      db.exec(`CREATE TABLE votaveis (cd_cargo INTEGER, nr_votavel INTEGER, nome TEXT, sq_candidato INTEGER, ds_cargo TEXT);
               CREATE TABLE locais (uf TEXT, cd_municipio TEXT, nm_municipio TEXT, zona INTEGER, nr_local INTEGER, nome TEXT, endereco TEXT, nome_norm TEXT);`);
      db.exec("BEGIN");
      const sv = db.prepare("INSERT INTO votaveis VALUES (?, ?, ?, ?, ?)");
      for (const v of votaveis.values()) sv.run(...v);
      const sl = db.prepare("INSERT INTO locais VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const v of locais.values()) sl.run(...v, normalizar(v[5]));
      db.exec("COMMIT");
      db.exec("CREATE INDEX ix_votaveis ON votaveis (cd_cargo, nr_votavel); CREATE INDEX ix_locais ON locais (zona, nr_local);");
    });
    return { linhas: { ...linhas, votaveis: votaveis.size, locais: locais.size } };
  },
  abrir: (destino, m) => abrirBanco(destino, m.extras),
};
