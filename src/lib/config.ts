import { homedir } from "node:os";
import { join } from "node:path";

export const USER_AGENT =
  process.env.MCP_ELEITORAL_USER_AGENT ??
  "mcp-eleitoral/0.2 (+https://github.com/lukeboh/mcp-eleitoral)";

/** Diretório onde as bases baixadas do TSE ficam guardadas. */
export function diretorioCache(): string {
  return (
    process.env.MCP_ELEITORAL_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mcp-eleitoral")
  );
}

/** Bases até este tamanho são baixadas sem pedir confirmação ao usuário. */
export function limiteDownloadAutomaticoBytes(): number {
  const mb = Number(process.env.MCP_ELEITORAL_DOWNLOAD_AUTOMATICO_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}
