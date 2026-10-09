import type { Geocodificador } from "./services/geocoding/geocodificador.js";
import type { FonteLocais } from "./services/locais-votacao/fonte.js";

/** Dependências compartilhadas pelos serviços. Facilita trocar implementações em testes. */
export interface Contexto {
  locais: FonteLocais;
  geocodificador: Geocodificador;
}
