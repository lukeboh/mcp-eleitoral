export function formatarBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "tamanho desconhecido";
  if (n === 0) return "0 MB";
  if (n < 1024 * 1024) return `${Math.max(0.1, n / 1024 / 1024).toFixed(1)} MB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatarDuracao(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "?";
  if (segundos < 60) return `${Math.ceil(segundos)} s`;
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return m < 60 ? `${m} min ${s} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
