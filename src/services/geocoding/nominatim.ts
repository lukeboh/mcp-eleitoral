import { buscarJson } from "../../lib/http.js";
import type { Geocodificador, ResultadoGeocodificacao } from "./geocodificador.js";

interface RespostaNominatim {
  lat: string;
  lon: string;
  display_name: string;
}

const CEP = /^\s*(\d{5})-?(\d{3})\s*$/;

/**
 * Geocodificação via Nominatim (OpenStreetMap).
 * Política de uso: máx. 1 requisição/s e User-Agent identificável
 * (https://operations.osmfoundation.org/policies/nominatim/).
 */
export class GeocodificadorNominatim implements Geocodificador {
  private ultimaChamada = 0;

  constructor(
    private readonly urlBase = process.env.MCP_ELEITORAL_NOMINATIM_URL ??
      "https://nominatim.openstreetmap.org",
  ) {}

  async geocodificar(endereco: string): Promise<ResultadoGeocodificacao | null> {
    const params = new URLSearchParams({ format: "jsonv2", limit: "1", "accept-language": "pt-BR" });
    const cep = CEP.exec(endereco);
    if (cep) {
      params.set("postalcode", `${cep[1]}-${cep[2]}`);
      params.set("countrycodes", "br");
    } else {
      params.set("q", endereco);
    }

    await this.respeitarLimite();
    const resultados = await buscarJson<RespostaNominatim[]>(`${this.urlBase}/search?${params}`);
    const r = resultados[0];
    if (!r) return null;
    return {
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      enderecoEncontrado: r.display_name,
      fonte: "OpenStreetMap Nominatim",
    };
  }

  private async respeitarLimite() {
    const espera = this.ultimaChamada + 1100 - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    this.ultimaChamada = Date.now();
  }
}
