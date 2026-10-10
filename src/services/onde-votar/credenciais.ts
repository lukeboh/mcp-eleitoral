/** Dados que o eleitor informa na tela de login do Autoatendimento Eleitoral. */
export interface CredenciaisEleitor {
  /** CPF (11 dígitos), número do título (12 dígitos) ou nome completo. */
  identificacao: string;
  /** Data de nascimento: só dígitos, ddmmaaaa (formato da máscara do site). */
  dataNascimento: string;
  nomeMae: string;
}

export type TipoIdentificacao = "cpf" | "titulo" | "nome";

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

/** Classifica e normaliza a identificação (remove pontuação de CPF/título). */
export function normalizarIdentificacao(entrada: string): { tipo: TipoIdentificacao; valor: string } {
  const texto = entrada.trim();
  if (/^[\d.\-\s/]+$/.test(texto)) {
    const digitos = texto.replace(/\D/g, "");
    if (digitos.length === 11) {
      if (!cpfValido(digitos)) throw new Error("CPF inválido: confira os dígitos.");
      return { tipo: "cpf", valor: digitos };
    }
    if (digitos.length === 12) return { tipo: "titulo", valor: digitos };
    throw new Error("Informe um CPF (11 dígitos) ou um número de título (12 dígitos).");
  }
  if (texto.split(/\s+/).length < 2) throw new Error("Informe o nome completo do eleitor, o CPF ou o número do título.");
  return { tipo: "nome", valor: texto.replace(/\s+/g, " ") };
}

/** Aceita dd/mm/aaaa, dd-mm-aaaa, ddmmaaaa ou aaaa-mm-dd. Devolve ddmmaaaa. */
export function normalizarDataNascimento(entrada: string): string {
  const t = entrada.trim();
  let d: string, m: string, a: string;
  let partes: RegExpExecArray | null;
  if ((partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) [, a, m, d] = partes;
  else if ((partes = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [, d, m, a] = partes;
  else if ((partes = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) [, d, m, a] = partes;
  else throw new Error("Data de nascimento inválida. Use dd/mm/aaaa.");
  d = d.padStart(2, "0");
  m = m.padStart(2, "0");
  const data = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (data.getUTCDate() !== Number(d) || data.getUTCMonth() !== Number(m) - 1 || data > new Date()) {
    throw new Error("Data de nascimento inválida.");
  }
  return `${d}${m}${a}`;
}

export function montarCredenciais(args: { identificacao: string; data_nascimento: string; nome_mae: string }): CredenciaisEleitor {
  const nomeMae = args.nome_mae.trim().replace(/\s+/g, " ");
  if (nomeMae.length < 3) throw new Error("Informe o nome completo da mãe, como consta no cadastro eleitoral.");
  return {
    identificacao: normalizarIdentificacao(args.identificacao).valor,
    dataNascimento: normalizarDataNascimento(args.data_nascimento),
    nomeMae,
  };
}
