import { USER_AGENT } from "./config.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} ao acessar ${url}`);
  }
}

export async function buscarJson<T>(
  url: string,
  opcoes: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...opcoes.headers },
    signal: AbortSignal.timeout(opcoes.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}
