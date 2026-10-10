// Importado antes de tudo: o node:sqlite emite um ExperimentalWarning ao ser carregado,
// que só polui o log do servidor (stderr). Os demais avisos continuam aparecendo.
const emitir = process.emitWarning.bind(process);
process.emitWarning = ((aviso: string | Error, ...resto: unknown[]) => {
  if (String(aviso instanceof Error ? aviso.message : aviso).includes("SQLite is an experimental feature")) return;
  (emitir as (...a: unknown[]) => void)(aviso, ...resto);
}) as typeof process.emitWarning;
