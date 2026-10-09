export interface Coordenadas {
  latitude: number;
  longitude: number;
}

const RAIO_TERRA_KM = 6371.0088;

/** Distância em linha reta (fórmula de haversine), em km. */
export function distanciaKm(a: Coordenadas, b: Coordenadas): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Converte coordenadas do TSE ("-15,8816041") em número.
 * O TSE usa "-1" (ou vazio) quando não há coordenada.
 */
export function parseCoordenada(valor: string | undefined): number | null {
  if (!valor) return null;
  const n = Number(valor.replace(",", "."));
  if (!Number.isFinite(n) || n === -1 || n === 0) return null;
  return n;
}
