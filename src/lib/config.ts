import { homedir } from "node:os";
import { join } from "node:path";

export const USER_AGENT =
  process.env.MCP_ELEITORAL_USER_AGENT ??
  "mcp-eleitoral/0.1 (+https://github.com/lukeboh/mcp-eleitoral)";

/** Diretório onde as bases baixadas do TSE ficam guardadas. */
export function diretorioCache(): string {
  return (
    process.env.MCP_ELEITORAL_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mcp-eleitoral")
  );
}

/** Ano da base de locais de votação. Padrão: o mais recente disponível. */
export function anoLocaisVotacao(): number | undefined {
  const ano = process.env.MCP_ELEITORAL_ANO;
  return ano ? Number(ano) : undefined;
}
