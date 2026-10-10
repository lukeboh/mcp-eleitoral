import type { Readable } from "node:stream";
import yauzl from "yauzl";

export interface EntradaZip {
  nome: string;
  tamanho: number;
  abrir(): Promise<Readable>;
}

/** Lista as entradas do .zip cujo nome casa com `filtro`. */
export function listarZip(caminho: string, filtro: RegExp = /./): Promise<{ entradas: EntradaZip[]; fechar: () => void }> {
  return new Promise((resolve, reject) => {
    yauzl.open(caminho, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entradas: EntradaZip[] = [];
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith("/") && filtro.test(entry.fileName)) {
          entradas.push({
            nome: entry.fileName,
            tamanho: entry.uncompressedSize,
            abrir: () =>
              new Promise((res, rej) => zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s)))),
          });
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve({ entradas, fechar: () => zip.close() }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/**
 * Percorre as entradas que casam com `filtro`, em sequência, informando progresso
 * agregado (bytes descompactados lidos / total das entradas).
 */
export async function paraCadaEntrada(
  caminho: string,
  filtro: RegExp,
  fn: (stream: Readable, entrada: EntradaZip) => Promise<void>,
  progresso?: (lidos: number, total: number) => void,
): Promise<EntradaZip[]> {
  const { entradas, fechar } = await listarZip(caminho, filtro);
  if (entradas.length === 0) {
    fechar();
    throw new Error(`Nenhum arquivo casando com ${filtro} em ${caminho}`);
  }
  const total = entradas.reduce((s, e) => s + e.tamanho, 0);
  let lidos = 0;
  try {
    for (const entrada of entradas) {
      const stream = await entrada.abrir();
      stream.on("data", (chunk: Buffer) => {
        lidos += chunk.length;
        progresso?.(lidos, total);
      });
      await fn(stream, entrada);
    }
  } finally {
    fechar();
  }
  return entradas;
}
