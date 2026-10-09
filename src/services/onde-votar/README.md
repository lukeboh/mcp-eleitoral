# Serviço "Onde votar" (consulta individual) — pendente

Consulta do local de votação de um eleitor específico, oferecida em
https://tn3.tse.jus.br/ (primeiro serviço da página).

**Status:** investigação concluída: a consulta exige login com hCaptcha. O site bloqueia
acessos de fora do Brasil (HTTP 403 via Akamai). Caminhos possíveis e detalhes
em `docs/investigacao-onde-votar.md`.

Quando a investigação estiver pronta, este diretório terá:

- `cliente.ts` — chamadas HTTP ao TSE (sessão, tokens, consulta);
- `esquemas.ts` — validação de entrada (CPF, título, data de nascimento…);
- `ferramentas.ts` — ferramenta MCP `onde_votar`, que devolve zona/seção e
  reaproveita `buscar_locais_votacao` para detalhar o local (endereço, coordenadas).

Regras: não registrar dados pessoais em log, não guardar cache de consultas
e não contornar captcha.
