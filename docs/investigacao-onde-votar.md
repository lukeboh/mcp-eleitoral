# Investigação: serviço "Onde votar" (tn3.tse.jus.br)

O site do TSE bloqueia acessos de fora do Brasil e de datacenters (HTTP 403 via
Akamai). Por isso a captura das chamadas precisa ser feita de um navegador no Brasil.

## Passo a passo

1. Abra https://tn3.tse.jus.br/ no Chrome ou Firefox.
2. Abra o DevTools (F12) → aba **Network** (Rede). Marque **Preserve log**.
3. Clique em **Onde votar** e faça uma consulta real até ver o resultado.
4. Anote, para cada requisição relevante (filtre por **Fetch/XHR**):
   - URL, método (GET/POST) e cabeçalhos especiais (tokens, `X-…`);
   - corpo enviado (quais campos: nome, CPF, título, data de nascimento, nome da mãe…);
   - formato da resposta (JSON ou HTML) e os campos devolvidos;
   - se existe captcha (reCAPTCHA, hCaptcha, Turnstile) e em que momento ele é exigido;
   - cookies ou tokens obtidos em requisições anteriores e reutilizados na consulta.
5. Exporte o HAR (botão direito na lista → **Save all as HAR**).

## Antes de compartilhar o HAR

O HAR contém **seus dados pessoais** (nome, CPF, título, endereço) e cookies de sessão.
Antes de enviar ou commitar:

- troque nome, CPF, título, datas e nome da mãe por valores fictícios;
- remova os cabeçalhos `Cookie`, `Set-Cookie` e `Authorization`;
- não versione o arquivo `.har` (já está no `.gitignore`).

Alternativa mais segura: descreva só as URLs, métodos, nomes dos campos e um exemplo
de resposta com valores fictícios.

## Decisão após a investigação

| Cenário | Caminho |
|---|---|
| API JSON sem captcha | Cliente HTTP direto em `src/services/onde-votar/` |
| Captcha obrigatório | Não contornar. Devolver ao usuário o link oficial e usar as ferramentas de dados abertos; avaliar pedido de acesso oficial ao TSE |
| Bloqueio geográfico | O MCP roda localmente na máquina do usuário (no Brasil) |
