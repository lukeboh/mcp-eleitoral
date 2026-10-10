import { join } from "node:path";
import { decimalOuNull, valorOuNull, type LinhaCsv } from "../../dados/csv.js";
import { abrirSomenteLeitura, col, criarIndices, criarTabela, importarCsv, novoBanco, type Coluna, type DatabaseSync, type Tabela } from "../../dados/sqlite.js";
import type { DefinicaoBase } from "../../dados/tipos.js";
import { listarZip, paraCadaEntrada } from "../../dados/zip.js";
import { normalizar } from "../../lib/texto.js";

const CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele";

export interface BancoContas {
  db: DatabaseSync;
  fechar(): void;
}

const texto = (nome: string, csv: string, max = 300): Coluna => ({
  nome,
  tipo: "TEXT",
  valor: (l) => {
    const v = valorOuNull(l[csv]);
    return v === null || v.startsWith("#") ? null : v.slice(0, max);
  },
});

/** Só guarda o documento quando é CNPJ (14 dígitos): CPFs de pessoas físicas ficam de fora. */
const cnpj = (nome: string, csv: string): Coluna => ({
  nome,
  tipo: "TEXT",
  valor: (l) => (/^\d{14}$/.test(l[csv] ?? "") ? l[csv] : null),
});

const tipoPessoa = (nome: string, csv: string): Coluna => ({
  nome,
  tipo: "TEXT",
  valor: (l) => {
    const d = l[csv] ?? "";
    return /^\d{14}$/.test(d) ? "PJ" : /^\d{11}$/.test(d) ? "PF" : null;
  },
});

const colunasCandidato: Coluna[] = [
  col.inteiro("sq_candidato", "SQ_CANDIDATO"),
  col.texto("uf", "SG_UE"),
  col.inteiro("cd_cargo", "CD_CARGO"),
  col.texto("ds_cargo", "DS_CARGO"),
  col.inteiro("numero", "NR_CANDIDATO"),
  col.texto("candidato", "NM_CANDIDATO"),
  { nome: "candidato_norm", tipo: "TEXT", valor: (l: LinhaCsv) => normalizar(l.NM_CANDIDATO ?? "") },
  col.texto("partido", "SG_PARTIDO"),
];

export const tabelaReceitas: Tabela = {
  nome: "receitas",
  colunas: [
    ...colunasCandidato,
    texto("fonte", "DS_FONTE_RECEITA"),
    texto("origem", "DS_ORIGEM_RECEITA"),
    texto("natureza", "DS_NATUREZA_RECEITA"),
    texto("especie", "DS_ESPECIE_RECEITA"),
    { nome: "doador", tipo: "TEXT", valor: (l) => valorOuNull(l.NM_DOADOR_RFB)?.replace(/^#.*/, "") || valorOuNull(l.NM_DOADOR) },
    tipoPessoa("tipo_doador", "NR_CPF_CNPJ_DOADOR"),
    cnpj("cnpj_doador", "NR_CPF_CNPJ_DOADOR"),
    texto("partido_doador", "SG_PARTIDO_DOADOR"),
    texto("data", "DT_RECEITA"),
    { nome: "valor", tipo: "REAL", valor: (l) => decimalOuNull(l.VR_RECEITA) ?? 0 },
  ],
  indices: [["sq_candidato"], ["cd_cargo", "uf"], ["partido"]],
};

export const tabelaDespesas: Tabela = {
  nome: "despesas",
  colunas: [
    ...colunasCandidato,
    texto("categoria", "DS_ORIGEM_DESPESA"),
    { nome: "fornecedor", tipo: "TEXT", valor: (l) => valorOuNull(l.NM_FORNECEDOR_RFB)?.replace(/^#.*/, "") || valorOuNull(l.NM_FORNECEDOR) },
    tipoPessoa("tipo_fornecedor", "NR_CPF_CNPJ_FORNECEDOR"),
    cnpj("cnpj_fornecedor", "NR_CPF_CNPJ_FORNECEDOR"),
    { nome: "fornecedor_norm", tipo: "TEXT", valor: (l) => normalizar(l.NM_FORNECEDOR_RFB || l.NM_FORNECEDOR || "") },
    texto("atividade_fornecedor", "DS_CNAE_FORNECEDOR"),
    texto("descricao", "DS_DESPESA", 200),
    texto("data", "DT_DESPESA"),
    { nome: "valor", tipo: "REAL", valor: (l) => decimalOuNull(l.VR_DESPESA_CONTRATADA) ?? 0 },
  ],
  indices: [["sq_candidato"], ["cd_cargo", "uf"], ["partido"], ["cnpj_fornecedor"]],
};

export const basePrestacaoContas: DefinicaoBase<BancoContas> = {
  id: "prestacao-contas",
  titulo: "Prestação de contas eleitorais dos candidatos",
  descricao:
    "Receitas (com origem: Fundo Especial, Fundo Partidário, pessoas físicas, recursos próprios…) e despesas contratadas " +
    "(por categoria e fornecedor) de cada candidato. CPFs de doadores e fornecedores pessoas físicas não são guardados.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_${ano}.zip`,
  versao: 1,
  async processar({ zip, destino, progresso }) {
    const db = novoBanco(join(destino, "dados.sqlite"));
    const linhas: Record<string, number> = {};
    try {
      const etapas = [
        [/^receitas_candidatos_\d+_BRASIL\.csv$/i, tabelaReceitas],
        [/^despesas_contratadas_candidatos_\d+_BRASIL\.csv$/i, tabelaDespesas],
      ] as const;
      // Progresso único sobre as duas entradas: soma os tamanhos antes de começar.
      const { entradas, fechar } = await listarZip(zip, /\.csv$/i);
      fechar();
      const totalGeral = entradas.filter((e) => etapas.some(([f]) => f.test(e.nome))).reduce((s, e) => s + e.tamanho, 0);
      let base = 0;
      for (const [filtro, tabela] of etapas) {
        criarTabela(db, tabela);
        const lidas = await paraCadaEntrada(
          zip,
          filtro,
          async (s) => void (linhas[tabela.nome] = await importarCsv(db, tabela, s)),
          (l) => progresso(base + l, totalGeral),
        );
        base += lidas.reduce((s, e) => s + e.tamanho, 0);
        criarIndices(db, tabela);
      }
      db.exec("ANALYZE");
    } finally {
      db.close();
    }
    return { linhas };
  },
  abrir(destino) {
    const db = abrirSomenteLeitura(join(destino, "dados.sqlite"));
    return { db, fechar: () => db.close() };
  },
};
