import { join } from "node:path";
import { decimalOuNull, valorOuNull, type LinhaCsv } from "../../dados/csv.js";
import { abrirSomenteLeitura, col, criarIndices, criarTabela, importarCsv, novoBanco, type Coluna, type DatabaseSync, type Tabela } from "../../dados/sqlite.js";
import type { DefinicaoBase } from "../../dados/tipos.js";
import { paraCadaEntrada } from "../../dados/zip.js";
import { normalizar } from "../../lib/texto.js";

const CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele";

export interface BancoCandidatos {
  db: DatabaseSync;
  fechar(): void;
}

const abrir = (destino: string): BancoCandidatos => {
  const db = abrirSomenteLeitura(join(destino, "dados.sqlite"));
  return { db, fechar: () => db.close() };
};

/** Texto do TSE com "#NULO", "#NE", "NÃO DIVULGÁVEL" etc. tratados como ausentes. */
const texto = (nome: string, csv: string): Coluna => ({
  nome,
  tipo: "TEXT",
  valor: (l) => {
    const v = valorOuNull(l[csv]);
    return v === null || /^(#|NÃO DIVULGÁVEL|NAO DIVULGAVEL|-4$)/i.test(v) ? null : v;
  },
});

async function importarUma(zip: string, destino: string, progresso: (a: number, b: number) => void, tabela: Tabela, filtro = /_BRASIL\.csv$/i) {
  const db = novoBanco(join(destino, "dados.sqlite"));
  let linhas = 0;
  try {
    criarTabela(db, tabela);
    await paraCadaEntrada(zip, filtro, async (s) => void (linhas += await importarCsv(db, tabela, s)), progresso);
    criarIndices(db, tabela);
    db.exec("ANALYZE");
  } finally {
    db.close();
  }
  return { linhas };
}

/**
 * Candidaturas: uma linha por candidato e turno. Não guardamos CPF, e-mail, título nem data de
 * nascimento (o TSE já os omite em boa parte; a idade na posse vem da base complementar).
 */
export const tabelaCandidaturas: Tabela = {
  nome: "candidaturas",
  colunas: [
    col.inteiro("sq_candidato", "SQ_CANDIDATO"),
    col.inteiro("turno", "NR_TURNO"),
    col.texto("uf", "SG_UE"),
    col.texto("nm_ue", "NM_UE"),
    col.inteiro("cd_cargo", "CD_CARGO"),
    col.texto("ds_cargo", "DS_CARGO"),
    col.inteiro("numero", "NR_CANDIDATO"),
    col.texto("nome", "NM_CANDIDATO"),
    col.texto("nome_urna", "NM_URNA_CANDIDATO"),
    texto("nome_social", "NM_SOCIAL_CANDIDATO"),
    { nome: "nome_norm", tipo: "TEXT", valor: (l: LinhaCsv) => `${normalizar(l.NM_URNA_CANDIDATO ?? "")} | ${normalizar(l.NM_CANDIDATO ?? "")}` },
    texto("situacao_candidatura", "DS_SITUACAO_CANDIDATURA"),
    col.texto("partido", "SG_PARTIDO"),
    col.inteiro("nr_partido", "NR_PARTIDO"),
    texto("federacao", "NM_FEDERACAO"),
    texto("coligacao", "NM_COLIGACAO"),
    texto("composicao", "DS_COMPOSICAO_COLIGACAO"),
    texto("uf_nascimento", "SG_UF_NASCIMENTO"),
    texto("genero", "DS_GENERO"),
    texto("grau_instrucao", "DS_GRAU_INSTRUCAO"),
    texto("estado_civil", "DS_ESTADO_CIVIL"),
    texto("cor_raca", "DS_COR_RACA"),
    texto("ocupacao", "DS_OCUPACAO"),
    texto("situacao", "DS_SIT_TOT_TURNO"),
  ],
  indices: [["sq_candidato", "turno"], ["cd_cargo", "uf"], ["partido"]],
};

export const baseCandidatos: DefinicaoBase<BancoCandidatos> = {
  id: "candidatos",
  titulo: "Candidatos",
  descricao: "Candidaturas registradas: cargo, número, partido, coligação, gênero, cor/raça, instrução, ocupação e situação.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/consulta_cand/consulta_cand_${ano}.zip`,
  versao: 1,
  processar: ({ zip, destino, progresso }) => importarUma(zip, destino, progresso, tabelaCandidaturas),
  abrir,
};

export const tabelaComplementar: Tabela = {
  nome: "complementar",
  colunas: [
    col.inteiro("sq_candidato", "SQ_CANDIDATO"),
    texto("nacionalidade", "DS_NACIONALIDADE"),
    texto("municipio_nascimento", "NM_MUNICIPIO_NASCIMENTO"),
    { nome: "idade_posse", tipo: "INTEGER", valor: (l) => (Number(l.NR_IDADE_DATA_POSSE) > 0 ? Number(l.NR_IDADE_DATA_POSSE) : null) },
    texto("reeleicao", "ST_REELEICAO"),
    texto("quilombola", "ST_QUILOMBOLA"),
    texto("etnia_indigena", "DS_ETNIA_INDIGENA"),
    { nome: "despesa_max_campanha", tipo: "REAL", valor: (l) => decimalOuNull(l.VR_DESPESA_MAX_CAMPANHA) },
    texto("situacao_julgamento", "DS_SITUACAO_JULGAMENTO"),
    texto("situacao_cassacao", "DS_SITUACAO_CASSACAO"),
    texto("situacao_diploma", "DS_SITUACAO_DIPLOMA"),
    texto("declarou_bens", "ST_DECLARAR_BENS"),
  ],
  indices: [["sq_candidato"]],
};

export const baseCandidatosComplementar: DefinicaoBase<BancoCandidatos> = {
  id: "candidatos-complementar",
  titulo: "Candidatos - Informações complementares",
  descricao: "Idade na posse, naturalidade, se tenta a reeleição, teto de gastos, situação de julgamento e cassação.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/consulta_cand_complementar/consulta_cand_complementar_${ano}.zip`,
  versao: 1,
  processar: ({ zip, destino, progresso }) => importarUma(zip, destino, progresso, tabelaComplementar),
  abrir,
};

export const tabelaBens: Tabela = {
  nome: "bens",
  colunas: [
    col.inteiro("sq_candidato", "SQ_CANDIDATO"),
    col.texto("uf", "SG_UE"),
    col.inteiro("ordem", "NR_ORDEM_BEM_CANDIDATO"),
    texto("tipo", "DS_TIPO_BEM_CANDIDATO"),
    texto("descricao", "DS_BEM_CANDIDATO"),
    { nome: "valor", tipo: "REAL", valor: (l) => decimalOuNull(l.VR_BEM_CANDIDATO) ?? 0 },
  ],
  indices: [["sq_candidato"]],
};

export const baseBensCandidatos: DefinicaoBase<BancoCandidatos> = {
  id: "bens-candidatos",
  titulo: "Bens declarados pelos candidatos",
  descricao: "Bens e valores declarados por cada candidato no registro da candidatura.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/bem_candidato/bem_candidato_${ano}.zip`,
  versao: 1,
  processar: ({ zip, destino, progresso }) => importarUma(zip, destino, progresso, tabelaBens),
  abrir,
};

export const tabelaColigacoes: Tabela = {
  nome: "coligacoes",
  colunas: [
    col.inteiro("turno", "NR_TURNO"),
    col.texto("uf", "SG_UE"),
    col.inteiro("cd_cargo", "CD_CARGO"),
    col.texto("ds_cargo", "DS_CARGO"),
    texto("tipo", "TP_AGREMIACAO"),
    col.texto("partido", "SG_PARTIDO"),
    col.inteiro("nr_partido", "NR_PARTIDO"),
    texto("federacao", "NM_FEDERACAO"),
    texto("coligacao", "NM_COLIGACAO"),
    texto("composicao", "DS_COMPOSICAO_COLIGACAO"),
    texto("situacao", "DS_SITUACAO"),
  ],
  indices: [["cd_cargo", "uf"]],
};

export const baseColigacoes: DefinicaoBase<BancoCandidatos> = {
  id: "coligacoes",
  titulo: "Coligações e federações",
  descricao: "Partidos, federações e coligações de cada cargo em cada UF/município.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/consulta_coligacao/consulta_coligacao_${ano}.zip`,
  versao: 1,
  processar: ({ zip, destino, progresso }) => importarUma(zip, destino, progresso, tabelaColigacoes),
  abrir,
};

export const tabelaVagas: Tabela = {
  nome: "vagas",
  colunas: [
    col.texto("uf", "SG_UE"),
    col.texto("nm_ue", "NM_UE"),
    col.inteiro("cd_cargo", "CD_CARGO"),
    col.texto("ds_cargo", "DS_CARGO"),
    col.inteiro("vagas", "QT_VAGA"),
    col.texto("posse", "DT_POSSE"),
  ],
  indices: [["cd_cargo", "uf"]],
};

export const baseVagas: DefinicaoBase<BancoCandidatos> = {
  id: "vagas",
  titulo: "Vagas em disputa",
  descricao: "Número de vagas de cada cargo em cada UF/município e data da posse.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/consulta_vagas/consulta_vagas_${ano}.zip`,
  versao: 1,
  processar: ({ zip, destino, progresso }) => importarUma(zip, destino, progresso, tabelaVagas),
  abrir,
};
