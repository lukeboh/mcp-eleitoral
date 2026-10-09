/** Baixa (ou rebaixa) a base de locais de votação do TSE para o cache local. Uso: npm run dados:atualizar [ano] */
import { carregarBaseLocais } from "../src/services/locais-votacao/dataset.js";

const ano = process.argv[2] ? Number(process.argv[2]) : undefined;
const base = await carregarBaseLocais({ ano, forcarDownload: true, log: console.log });
console.log(JSON.stringify(base.metadados, null, 2));
