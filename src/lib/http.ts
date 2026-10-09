import { createWriteStream } from "node:fs";
import { rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { USER_AGENT } from "./config.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} ao acessar ${url}`);
  }
}

export async function existe(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
  return res.ok;
}

/** Baixa um arquivo para `destino` de forma atômica (grava em .part e renomeia). */
export async function baixarArquivo(url: string, destino: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new HttpError(res.status, url);
  await mkdir(dirname(destino), { recursive: true });
  const parcial = `${destino}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(parcial));
  await rename(parcial, destino);
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
