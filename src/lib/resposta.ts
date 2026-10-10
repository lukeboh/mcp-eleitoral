import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function respostaJson(dados: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(dados, null, 2) }] };
}

export function respostaErro(erro: unknown): CallToolResult {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return { isError: true, content: [{ type: "text", text: mensagem }] };
}

/** Envolve um handler de ferramenta convertendo exceções em resposta de erro legível. */
export function comTratamento<A, E>(fn: (args: A, extra: E) => Promise<CallToolResult>) {
  return async (args: A, extra: E): Promise<CallToolResult> => {
    try {
      return await fn(args, extra);
    } catch (e) {
      return respostaErro(e);
    }
  };
}
