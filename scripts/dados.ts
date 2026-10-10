/**
 * Gerencia as bases do TSE pelo terminal.
 *
 *   npm run dados -- listar
 *   npm run dados -- info <base> [--ano 2026] [--uf DF]
 *   npm run dados -- baixar <base> [--ano 2026] [--uf DF] [--atualizar] [--sim]
 *   npm run dados -- remover <base> [--ano 2026] [--uf DF]
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { criarGerenciador } from "../src/criar-gerenciador.js";
import { formatarBytes } from "../src/dados/formato.js";
import { descreverParams, descreverProgresso } from "../src/dados/gerenciador.js";
import type { Progresso } from "../src/dados/tipos.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    ano: { type: "string" },
    uf: { type: "string" },
    atualizar: { type: "boolean" },
    sim: { type: "boolean", short: "y" },
  },
});
const [comando = "listar", id] = positionals;
const params = { ano: values.ano ? Number(values.ano) : undefined, uf: values.uf };
const bases = criarGerenciador(() => {});

function exigirBase() {
  if (!id) {
    console.error(`Informe a base. Disponíveis: ${bases.listarDefinicoes().map((d) => d.id).join(", ")}`);
    process.exit(1);
  }
  return id;
}

switch (comando) {
  case "listar": {
    for (const def of bases.listarDefinicoes()) {
      if (def.porUf) {
        console.log(`${def.id.padEnd(28)} por UF (use: info ${def.id})  ${def.titulo}`);
        continue;
      }
      const i = await bases.informacoes(def.id, params).catch((e: Error) => ({ erro: e.message }) as const);
      if ("erro" in i) console.log(`${def.id.padEnd(28)} ${i.erro}`);
      else console.log(`${def.id.padEnd(28)} ${String(i.params.ano ?? "-").padEnd(5)} ${i.tamanho_download.padStart(10)}  ${i.situacao.padEnd(12)} ${def.titulo}`);
    }
    const baixadas = await bases.baixadas();
    console.log(`\nEm disco: ${formatarBytes(baixadas.reduce((s, m) => s + m.tamanhoDisco, 0))} (${baixadas.length} bases)`);
    break;
  }
  case "info": {
    const def = bases.definicao(exigirBase());
    const ufs = def.porUf && !params.uf ? (def.ufs ?? (await import("../src/dados/gerenciador.js")).UFS) : [params.uf];
    for (const uf of ufs) {
      const i = await bases.informacoes(def.id, { ...params, uf });
      console.log(`${def.id} ${descreverParams(i.params).padEnd(16)} ${i.tamanho_download.padStart(10)}  ${i.situacao}${i.tamanho_em_disco ? ` (${i.tamanho_em_disco} em disco)` : ""}`);
    }
    break;
  }
  case "baixar": {
    const base = exigirBase();
    const info = await bases.informacoes(base, params);
    console.log(`${info.titulo} (${descreverParams(info.params) || "única"}): download de ${info.tamanho_download}.`);
    if (info.situacao === "pronta" && !values.atualizar) {
      console.log("Já está baixada. Use --atualizar para baixar de novo.");
      break;
    }
    if (!values.sim && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const resp = await rl.question("Continuar? [s/N] ");
      rl.close();
      if (!/^s/i.test(resp.trim())) process.exit(0);
    }
    const r = await bases.iniciarDownload(base, info.params, { forcar: values.atualizar });
    let ultimoDesenho = 0;
    const desenhar = (p: Progresso) => {
      if (p !== r.progresso || (Date.now() - ultimoDesenho < 250 && p.fase !== "pronta")) return;
      ultimoDesenho = Date.now();
      const frac = p.total ? p.feito / p.total : 0;
      const largura = 30;
      const barra = "█".repeat(Math.round(frac * largura)).padEnd(largura, "░");
      process.stdout.write(`\r${p.fase === "baixando" ? "Baixando   " : "Processando"} ${barra} ${descreverProgresso(p)}`.padEnd(140));
    };
    bases.on("progresso", desenhar);
    await r.promessa;
    process.stdout.write("\n");
    const final = await bases.informacoes(base, info.params);
    console.log(`Pronta: ${final.tamanho_em_disco} em disco.`);
    break;
  }
  case "remover": {
    console.log((await bases.remover(exigirBase(), params)) ? "Removida." : "Não estava baixada.");
    break;
  }
  default:
    console.error(`Comando desconhecido: ${comando}. Use listar, info, baixar ou remover.`);
    process.exit(1);
}
