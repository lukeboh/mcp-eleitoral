import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function respostaJson(dados: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(dados, null, 2) }] };
}

export function respostaErro(erro: unknown): CallToolResult {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return { isError: true, content: [{ type: "text", text: mensagem }] };
}

/** Envolve um handler de ferramenta convertendo exceções em resposta de erro legível. */
export function comTratamento<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      return respostaErro(e);
    }
  };
}
