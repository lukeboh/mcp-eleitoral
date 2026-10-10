import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "../lib/config.js";
import { HttpError } from "../lib/http.js";

export interface InfoRemota {
  existe: boolean;
  tamanho: number | null;
  ultimaModificacao: string | null;
}

/** HEAD na URL (ou stat, para file://) para saber se existe, o tamanho e a data. */
export async function infoRemota(url: string): Promise<InfoRemota> {
  if (url.startsWith("file:")) {
    try {
      const s = await stat(fileURLToPath(url));
      return { existe: true, tamanho: s.size, ultimaModificacao: s.mtime.toUTCString() };
    } catch {
      return { existe: false, tamanho: null, ultimaModificacao: null };
    }
  }
  const res = await fetch(url, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { existe: false, tamanho: null, ultimaModificacao: null };
  const len = res.headers.get("content-length");
  return { existe: true, tamanho: len ? Number(len) : null, ultimaModificacao: res.headers.get("last-modified") };
}

/** Baixa `url` para `destino` (atomicamente), informando bytes baixados. */
export async function baixar(
  url: string,
  destino: string,
  progresso: (baixados: number, total: number | null) => void,
): Promise<void> {
  await mkdir(dirname(destino), { recursive: true });
  const parcial = `${destino}.part`;
  if (url.startsWith("file:")) {
    const origem = fileURLToPath(url);
    const { size } = await stat(origem);
    await copyFile(origem, parcial);
    progresso(size, size);
  } else {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok || !res.body) throw new HttpError(res.status, url);
    const len = res.headers.get("content-length");
    const total = len ? Number(len) : null;
    let baixados = 0;
    const contador = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        baixados += chunk.length;
        progresso(baixados, total);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), contador, createWriteStream(parcial));
  }
  await rename(parcial, destino);
}
