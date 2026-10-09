import { distanciaKm, type Coordenadas } from "../../lib/geo.js";
import { normalizar } from "../../lib/texto.js";
import { normalizarMunicipio, resolverUf, UF_EXTERIOR } from "./localidades.js";
import type { BaseLocais, LocalVotacao, MetadadosBase } from "./tipos.js";

export type Escopo = "todos" | "brasil" | "exterior";
export type Agrupamento = "uf" | "municipio" | "zona" | "bairro" | "tipo";

export interface FiltroLocais {
  /** Sigla, nome da UF ou "exterior". */
  uf?: string;
  /** Município (ou cidade no exterior). Comparação sem acento; aceita apelidos como "NY". */
  municipio?: string;
  zona?: number;
  secao?: number;
  bairro?: string;
  /** Trecho do nome do local (ex.: "escola classe"). */
  nome?: string;
  escopo?: Escopo;
  /** Por padrão só locais ATIVOS. */
  incluirInativos?: boolean;
  /** Por padrão exclui locais de "Preso provisório" e afins (só "Convencional"). */
  incluirEspeciais?: boolean;
}

export interface ResultadoFiltro {
  locais: LocalVotacao[];
  /** Municípios que casaram com o filtro — útil para o modelo desambiguar. */
  municipios: string[];
  avisos: string[];
}

export interface Grupo {
  chave: string;
  locais: number;
  secoes: number;
  eleitores: number;
}

export interface Contagem {
  locais: number;
  secoes: number;
  eleitores: number;
  municipios: string[];
  grupos?: Grupo[];
  avisos: string[];
}

export interface LocalComDistancia extends LocalVotacao {
  distanciaKm: number;
}

/** Consultas em memória sobre a base de locais de votação. */
export class RepositorioLocais {
  private readonly normalizados: { local: LocalVotacao; municipio: string; bairro: string; nome: string }[];

  constructor(private readonly base: BaseLocais) {
    this.normalizados = base.locais.map((local) => ({
      local,
      municipio: normalizar(local.municipio),
      bairro: normalizar(local.bairro),
      nome: normalizar(local.nome),
    }));
  }

  get metadados(): MetadadosBase {
    return this.base.metadados;
  }

  filtrar(filtro: FiltroLocais = {}): ResultadoFiltro {
    const avisos: string[] = [];
    let uf: string | undefined;
    if (filtro.uf) {
      uf = resolverUf(filtro.uf);
      if (!uf) return { locais: [], municipios: [], avisos: [`UF desconhecida: "${filtro.uf}".`] };
    }
    const escopo = filtro.escopo ?? "todos";
    const bairro = filtro.bairro && normalizar(filtro.bairro);
    const nome = filtro.nome && normalizar(filtro.nome);

    let candidatos = this.normalizados.filter(({ local, bairro: b, nome: n }) => {
      if (uf && local.uf !== uf) return false;
      if (escopo === "brasil" && local.uf === UF_EXTERIOR) return false;
      if (escopo === "exterior" && local.uf !== UF_EXTERIOR) return false;
      if (filtro.zona !== undefined && local.zona !== filtro.zona) return false;
      if (filtro.secao !== undefined && !local.secoes.includes(filtro.secao)) return false;
      if (!filtro.incluirInativos && local.situacao !== "ATIVO") return false;
      if (!filtro.incluirEspeciais && local.tipo !== "Convencional") return false;
      if (bairro && !b.includes(bairro)) return false;
      if (nome && !n.includes(nome)) return false;
      return true;
    });

    if (filtro.municipio) {
      const alvo = normalizarMunicipio(filtro.municipio);
      const exatos = candidatos.filter((c) => c.municipio === alvo);
      if (exatos.length > 0) {
        candidatos = exatos;
      } else {
        candidatos = candidatos.filter((c) => c.municipio.includes(alvo));
        if (candidatos.length > 0) {
          avisos.push(`Nenhum município chamado exatamente "${filtro.municipio}"; usando correspondência parcial.`);
        }
      }
    }

    const locais = candidatos.map((c) => c.local);
    const municipios = [...new Set(locais.map((l) => `${l.municipio}/${l.uf}`))].sort();
    if (filtro.municipio && municipios.length > 1) {
      avisos.push(`O filtro de município casou com ${municipios.length} municípios; informe a UF para restringir.`);
    }
    return { locais, municipios, avisos };
  }

  contar(filtro: FiltroLocais = {}, agruparPor?: Agrupamento, maxGrupos = 50): Contagem {
    const { locais, municipios, avisos } = this.filtrar(filtro);
    const total = somar(locais);
    const contagem: Contagem = { ...total, municipios: municipios.slice(0, 20), avisos };
    if (agruparPor) {
      const grupos = new Map<string, LocalVotacao[]>();
      for (const l of locais) {
        const chave = chaveGrupo(l, agruparPor);
        (grupos.get(chave) ?? grupos.set(chave, []).get(chave)!).push(l);
      }
      contagem.grupos = [...grupos.entries()]
        .map(([chave, ls]) => ({ chave, ...somar(ls) }))
        .sort((a, b) => b.locais - a.locais)
        .slice(0, maxGrupos);
      if (grupos.size > maxGrupos) avisos.push(`Mostrando os ${maxGrupos} maiores de ${grupos.size} grupos.`);
    }
    return contagem;
  }

  /** Locais com coordenadas, ordenados por distância ao ponto. */
  maisProximos(
    ponto: Coordenadas,
    opcoes: { filtro?: FiltroLocais; limite?: number; raioKm?: number } = {},
  ): { locais: LocalComDistancia[]; semCoordenadas: number; avisos: string[] } {
    const { locais, avisos } = this.filtrar(opcoes.filtro);
    let semCoordenadas = 0;
    const comDistancia: LocalComDistancia[] = [];
    for (const l of locais) {
      if (l.latitude === null || l.longitude === null) {
        semCoordenadas++;
        continue;
      }
      const d = distanciaKm(ponto, { latitude: l.latitude, longitude: l.longitude });
      if (opcoes.raioKm === undefined || d <= opcoes.raioKm) comDistancia.push({ ...l, distanciaKm: d });
    }
    comDistancia.sort((a, b) => a.distanciaKm - b.distanciaKm);
    return { locais: comDistancia.slice(0, opcoes.limite ?? 5), semCoordenadas, avisos };
  }
}

function somar(locais: LocalVotacao[]) {
  let secoes = 0;
  let eleitores = 0;
  for (const l of locais) {
    secoes += l.secoes.length;
    eleitores += l.eleitores;
  }
  return { locais: locais.length, secoes, eleitores };
}

function chaveGrupo(l: LocalVotacao, por: Agrupamento): string {
  switch (por) {
    case "uf":
      return l.uf;
    case "municipio":
      return `${l.municipio}/${l.uf}`;
    case "zona":
      return `Zona ${l.zona}/${l.uf}`;
    case "bairro":
      return `${l.bairro} - ${l.municipio}/${l.uf}`;
    case "tipo":
      return l.tipo;
  }
}
