import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { comTratamento, respostaJson } from "../lib/resposta.js";
import { formatarBytes } from "./formato.js";
import { descreverParams, descreverProgresso, UFS, type GerenciadorBases } from "./gerenciador.js";
import type { Progresso } from "./tipos.js";

const paramsBase = {
  ano: z.number().int().min(1990).max(2100).optional().describe("Ano da base. Padrão: o mais recente publicado."),
  uf: z.string().length(2).optional().describe("UF, para bases publicadas por estado (ex.: votação por seção)."),
};

export function registrarGestaoBases(server: McpServer, bases: GerenciadorBases) {
  const ids = bases.listarDefinicoes().map((d) => d.id) as [string, ...string[]];

  server.registerTool(
    "listar_bases",
    {
      title: "Bases de dados do TSE",
      description:
        "Lista as bases de dados abertos do TSE que este servidor usa, com o tamanho do download, se já foram baixadas, " +
        "espaço em disco e se há atualização. Use antes de baixar uma base para informar o tamanho ao usuário. " +
        "Com `base` (e `ano`/`uf`), detalha uma base; para bases por UF sem `uf`, mostra o tamanho de cada estado.",
      inputSchema: { base: z.enum(ids).optional(), ...paramsBase },
    },
    comTratamento(async (args) => {
      if (args.base) {
        const def = bases.definicao(args.base);
        if (def.porUf && !args.uf) {
          const ufs = def.ufs ?? UFS;
          const infos = await Promise.all(ufs.map((uf) => bases.informacoes(def.id, { ano: args.ano, uf })));
          const total = infos.reduce((s, i) => s + (i.tamanho_download_bytes ?? 0), 0);
          return respostaJson({
            base: def.id,
            titulo: def.titulo,
            descricao: def.descricao,
            publicada_por_uf: true,
            tamanho_total_todas_ufs: formatarBytes(total),
            ufs: infos.map((i) => ({ uf: i.params.uf, ano: i.params.ano, tamanho_download: i.tamanho_download, situacao: i.situacao, progresso: i.progresso })),
          });
        }
        return respostaJson(await bases.informacoes(def.id, { ano: args.ano, uf: args.uf }));
      }

      const baixadas = await bases.baixadas();
      const catalogo = await Promise.all(
        bases.listarDefinicoes().map(async (def) => {
          const resumo = { base: def.id, titulo: def.titulo, descricao: def.descricao, por_ano: def.ano !== "nenhum", por_uf: !!def.porUf };
          if (def.porUf) {
            return {
              ...resumo,
              tamanho_download: "varia por UF — chame listar_bases com esta base para ver",
              ufs_baixadas: baixadas.filter((m) => m.id === def.id).map((m) => descreverParams(m.params)),
            };
          }
          try {
            const i = await bases.informacoes(def.id, { ano: args.ano });
            return { ...resumo, ano_padrao: i.params.ano, tamanho_download: i.tamanho_download, situacao: i.situacao, progresso: i.progresso, tamanho_em_disco: i.tamanho_em_disco, atualizacao_disponivel: i.atualizacao_disponivel };
          } catch (e) {
            return { ...resumo, erro: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      return respostaJson({
        bases: catalogo,
        baixadas: baixadas.map((m) => ({ base: m.id, params: m.params, tamanho_em_disco: formatarBytes(m.tamanhoDisco), baixada_em: m.baixadaEm })),
        espaco_total_em_disco: formatarBytes(baixadas.reduce((s, m) => s + m.tamanhoDisco, 0)),
        download_automatico_ate: formatarBytes(bases.limiteAutomatico),
      });
    }),
  );

  server.registerTool(
    "baixar_base",
    {
      title: "Baixar base de dados do TSE",
      description:
        "Baixa e prepara uma base de dados do TSE. SÓ chame depois que o usuário confirmar, informando antes o tamanho " +
        "(veja `listar_bases` ou a mensagem da ferramenta que pediu a base). Por padrão retorna imediatamente e o download " +
        "segue em segundo plano — acompanhe com `progresso_downloads`. Com `aguardar=true`, espera terminar e envia " +
        "notificações de progresso MCP.",
      inputSchema: {
        base: z.enum(ids),
        ...paramsBase,
        atualizar: z.boolean().optional().describe("Baixa de novo mesmo que já exista (para atualizar)."),
        aguardar: z.boolean().optional().describe("Espera o fim do download (padrão: false)."),
      },
    },
    comTratamento(async (args, extra) => {
      const info = await bases.informacoes(args.base, { ano: args.ano, uf: args.uf });
      const r = await bases.iniciarDownload(args.base, info.params, { forcar: args.atualizar });
      if (r.jaPronta) {
        return respostaJson({ mensagem: `A base "${info.titulo}" (${descreverParams(info.params)}) já está baixada. Use atualizar=true para baixar de novo.`, ...info });
      }

      if (args.aguardar) {
        const token = extra._meta?.progressToken;
        let ultimo = 0;
        const ouvinte = (p: Progresso) => {
          if (token === undefined || p !== r.progresso || Date.now() - ultimo < 1000) return;
          ultimo = Date.now();
          // Progresso global: download = 0–50, processamento = 50–100.
          const frac = p.total ? p.feito / p.total : 0;
          const progresso = p.fase === "baixando" ? frac * 50 : p.fase === "processando" ? 50 + frac * 50 : 100;
          void extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken: token, progress: Math.round(progresso), total: 100, message: descreverProgresso(p) },
          });
        };
        bases.on("progresso", ouvinte);
        try {
          await r.promessa;
        } finally {
          bases.off("progresso", ouvinte);
        }
        return respostaJson({ mensagem: "Base pronta.", ...(await bases.informacoes(args.base, info.params)) });
      }

      return respostaJson({
        mensagem:
          (r.jaEmAndamento ? "Download já estava em andamento. " : "Download iniciado em segundo plano. ") +
          `Tamanho: ${info.tamanho_download}. Acompanhe com \`progresso_downloads\`; quando terminar, refaça a consulta.`,
        base: info.base,
        titulo: info.titulo,
        params: info.params,
        tamanho_download: info.tamanho_download,
        progresso: r.progresso ? descreverProgresso(r.progresso) : undefined,
      });
    }),
  );

  server.registerTool(
    "progresso_downloads",
    {
      title: "Progresso dos downloads",
      description: "Mostra o andamento dos downloads de bases do TSE desta sessão: fase (baixando/processando), percentual, velocidade e tempo restante.",
      inputSchema: {},
    },
    comTratamento(async () => {
      const ps = bases.progressos();
      if (ps.length === 0) return respostaJson({ mensagem: "Nenhum download nesta sessão." });
      return respostaJson({
        downloads: ps.map((p) => ({
          base: p.base,
          titulo: p.titulo,
          params: p.params,
          fase: p.fase,
          percentual: p.total && (p.fase === "baixando" || p.fase === "processando") ? Math.round((p.feito / p.total) * 100) : p.fase === "pronta" ? 100 : null,
          descricao: descreverProgresso(p),
        })),
      });
    }),
  );

  server.registerTool(
    "remover_base",
    {
      title: "Remover base baixada",
      description: "Apaga do disco uma base do TSE já baixada, para liberar espaço.",
      inputSchema: { base: z.enum(ids), ...paramsBase },
    },
    comTratamento(async (args) => {
      const removida = await bases.remover(args.base, { ano: args.ano, uf: args.uf });
      return respostaJson({ removida });
    }),
  );
}
