/** Resultado da consulta "Onde votar", já sem campos internos do TSE. */
export interface DadosOndeVotar {
  eleitor: string | null;
  titulo: string | null;
  situacao_titulo: string | null;
  mensagem_situacao: string | null;
  local: {
    nome: string | null;
    endereco: string | null;
    bairro: string | null;
    municipio: string | null;
    uf: string | null;
    pais: string;
    exterior: boolean;
    zona: number | null;
    secao: number | null;
    numero_local: number | null;
    coordenadas: { latitude: number; longitude: number } | null;
    mapa: string | null;
  };
  mensagens: string[];
}

type Bruto = Record<string, any>;

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : v == null ? null : String(v));
const numero = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Converte a resposta de `v3/eleitores/onde-votar` no formato do MCP,
 * seguindo o mesmo mapeamento do front-end do tn3 (ondeVotara/domicilioEleitoral).
 * Só campos conhecidos são repassados.
 */
export function mapearRespostaOndeVotar(r: Bruto): DadosOndeVotar {
  const l: Bruto | undefined = r?.ondeVotara ?? r?.domicilioEleitoral;
  if (!l) throw new Error("O TSE respondeu sem dados de local de votação para este eleitor.");
  const exterior = l.uf === "ZZ";
  const latitude = numero(l.latitude);
  const longitude = numero(l.longitude);
  const temCoordenadas = latitude !== null && longitude !== null && latitude !== -1 && !(latitude === 0 && longitude === 0);
  return {
    eleitor: texto(r.eleitor?.nomeSocial) ?? texto(r.eleitor?.nomeCivil) ?? texto(r.eleitor?.nome),
    titulo: texto(r.eleitor?.inscricao),
    situacao_titulo: texto(r.situacaoEleitoral?.situacao?.nome),
    mensagem_situacao: texto(r.situacaoEleitoral?.mensagem),
    local: {
      nome: texto(l.nome),
      endereco: texto(l.endereco),
      bairro: exterior ? null : texto(l.bairro),
      municipio: texto(l.municipio),
      uf: exterior ? "ZZ" : texto(l.uf),
      pais: exterior ? (texto(l.bairro) ?? "Exterior") : "BRASIL",
      exterior,
      zona: numero(l.zona),
      secao: numero(l.secao),
      numero_local: numero(l.numeroLocal),
      coordenadas: temCoordenadas ? { latitude: latitude!, longitude: longitude! } : null,
      mapa: temCoordenadas ? `https://www.google.com/maps?q=${latitude},${longitude}` : null,
    },
    mensagens: Array.isArray(r.mensagens) ? r.mensagens.map((m: unknown) => texto(typeof m === "object" ? (m as Bruto)?.mensagem : m)).filter((m: string | null): m is string => !!m) : [],
  };
}
