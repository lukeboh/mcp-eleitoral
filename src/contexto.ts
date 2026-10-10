import type { GerenciadorBases } from "./dados/gerenciador.js";
import type { Geocodificador } from "./services/geocoding/geocodificador.js";
import type { ServicoOndeVotar } from "./services/onde-votar/consulta.js";

/** Dependências compartilhadas pelos serviços. Facilita trocar implementações em testes. */
export interface Contexto {
  bases: GerenciadorBases;
  geocodificador: Geocodificador;
  ondeVotar: Pick<ServicoOndeVotar, "consultar" | "continuar">;
}
