import type { GerenciadorBases } from "./dados/gerenciador.js";
import type { Geocodificador } from "./services/geocoding/geocodificador.js";

/** Dependências compartilhadas pelos serviços. Facilita trocar implementações em testes. */
export interface Contexto {
  bases: GerenciadorBases;
  geocodificador: Geocodificador;
}
