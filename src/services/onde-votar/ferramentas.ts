import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Contexto } from "../../contexto.js";
import { comTratamento, respostaJson } from "../../lib/resposta.js";
import { URL_ONDE_VOTAR, type ResultadoConsulta } from "./consulta.js";
import { montarCredenciais } from "./credenciais.js";

const FONTE = { descricao: "TSE - Autoatendimento Eleitoral, consulta Onde votar", url: URL_ONDE_VOTAR };

const INSTRUCOES_DESAFIO =
  "O hCaptcha do TSE pediu uma verificação humana. Uma janela do navegador foi aberta no computador do usuário " +
  "com a consulta preenchida. Peça ao usuário que resolva o desafio nessa janela e, em seguida, chame " +
  "`onde_votar_continuar` com esta `sessao`. A janela fecha sozinha ao final.";

function responder(r: ResultadoConsulta) {
  if (r.status === "desafio_pendente") {
    return respostaJson({ ...r, instrucoes: INSTRUCOES_DESAFIO });
  }
  return respostaJson({ status: "ok", ...r.dados, fonte: FONTE });
}

export function registrarOndeVotar(server: McpServer, ctx: Contexto) {
  server.registerTool(
    "onde_votar",
    {
      title: "Onde votar (consulta do eleitor)",
      description:
        "Consulta no TSE o local de votação, a zona e a seção de um eleitor, além da situação do título. " +
        "Use apenas para o próprio usuário ou para alguém que o autorizou, com dados que o usuário forneceu " +
        "ou que o assistente dele já conhece. Nunca use para descobrir dados de terceiros nem em lote. " +
        "Precisa de CPF, número do título ou nome completo, mais a data de nascimento e o nome da mãe. " +
        "A consulta é feita na página oficial do TSE, num navegador invisível. Se o captcha do TSE exigir " +
        'verificação humana, a resposta vem com status "desafio_pendente": siga as instruções que a acompanham. ' +
        "Leva de 10 a 40 segundos.",
      inputSchema: {
        identificacao: z.string().describe("CPF, número do título de eleitor (12 dígitos) ou nome completo."),
        data_nascimento: z.string().describe('Data de nascimento, ex.: "25/12/1980".'),
        nome_mae: z.string().describe("Nome completo da mãe, como consta no cadastro eleitoral."),
      },
    },
    comTratamento(async (args) => responder(await ctx.ondeVotar.consultar(montarCredenciais(args)))),
  );

  server.registerTool(
    "onde_votar_continuar",
    {
      title: "Onde votar: continuar após verificação",
      description:
        'Conclui uma consulta `onde_votar` que retornou "desafio_pendente", depois que o usuário resolveu ' +
        "o desafio na janela do navegador. Aguarda até cerca de 90 segundos. Se ainda estiver pendente, " +
        "pergunte ao usuário se concluiu a verificação e chame de novo.",
      inputSchema: {
        sessao: z.string().describe("Valor de `sessao` devolvido por `onde_votar`."),
      },
    },
    comTratamento(async ({ sessao }) => responder(await ctx.ondeVotar.continuar(sessao))),
  );
}
