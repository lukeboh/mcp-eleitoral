import type { DefinicaoBase } from "../../dados/tipos.js";
import { abrirCubo, DIMENSOES_PERFIL, processarCubo, type BancoCubo, type EspecCubo } from "./cubo.js";

const CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele";

export const ESPEC_ELEITORADO: EspecCubo = {
  turno: false,
  dimensoes: DIMENSOES_PERFIL,
  medidas: [
    { nome: "eleitores", csv: "QT_ELEITORES" },
    { nome: "biometria", csv: "QT_ELEITORES_BIOMETRIA" },
    { nome: "deficiencia", csv: "QT_ELEITORES_DEFICIENCIA" },
    { nome: "nome_social", csv: "QT_ELEITORES_NOME_SOCIAL" },
  ],
};

export const basePerfilEleitorado: DefinicaoBase<BancoCubo> = {
  id: "perfil-eleitorado",
  titulo: "Perfil do eleitorado (atual)",
  descricao:
    "Eleitores por gênero, faixa etária, instrução, cor/raça, estado civil, identidade de gênero, quilombola e Libras, " +
    "por município e zona — retrato atual do cadastro. CSV de 2,3 GB: o processamento leva alguns minutos.",
  ano: "nenhum",
  url: () => `${CDN}/perfil_eleitorado/perfil_eleitorado_ATUAL.zip`,
  versao: 1,
  processar: (ctx) => processarCubo(ctx, ESPEC_ELEITORADO),
  abrir: (destino, m) => abrirCubo(destino, m.extras),
};

export const ESPEC_COMPARECIMENTO: EspecCubo = {
  turno: true,
  // O arquivo de comparecimento chama a instrução de "grau de escolaridade".
  dimensoes: DIMENSOES_PERFIL.map((d) =>
    d.nome === "grau_instrucao" ? { ...d, csvCd: "CD_GRAU_ESCOLARIDADE", csvDs: "DS_GRAU_ESCOLARIDADE" } : d,
  ),
  medidas: [
    { nome: "aptos", csv: "QT_APTOS" },
    { nome: "comparecimento", csv: "QT_COMPARECIMENTO" },
    { nome: "abstencao", csv: "QT_ABSTENCAO" },
    { nome: "comparecimento_deficiencia", csv: "QT_COMPARECIMENTO_DEFICIENCIA" },
    { nome: "abstencao_deficiencia", csv: "QT_ABSTENCAO_DEFICIENCIA" },
  ],
};

export const basePerfilComparecimento: DefinicaoBase<BancoCubo> = {
  id: "perfil-comparecimento",
  titulo: "Perfil do comparecimento e da abstenção",
  descricao:
    "Aptos, comparecimento e abstenção por gênero, faixa etária, instrução, cor/raça e outros, por município e zona e turno. " +
    "Publicado alguns meses após a eleição. Arquivo grande: o processamento leva alguns minutos.",
  ano: "eleicao",
  url: ({ ano }) => `${CDN}/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_${ano}.zip`,
  versao: 1,
  processar: (ctx) => processarCubo(ctx, ESPEC_COMPARECIMENTO),
  abrir: (destino, m) => abrirCubo(destino, m.extras),
};
