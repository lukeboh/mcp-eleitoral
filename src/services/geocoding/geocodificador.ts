import type { Coordenadas } from "../../lib/geo.js";

export interface ResultadoGeocodificacao extends Coordenadas {
  /** Endereço como o serviço o entendeu — devolvido ao usuário para conferência. */
  enderecoEncontrado: string;
  fonte: string;
}

/** Converte endereço/CEP em coordenadas. Implementações podem ser trocadas (Nominatim, Google…). */
export interface Geocodificador {
  geocodificar(endereco: string): Promise<ResultadoGeocodificacao | null>;
}
