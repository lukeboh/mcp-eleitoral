# Investigação: serviço "Onde votar" (tn3.tse.jus.br)

Levantamento feito em 09/10/2026 a partir do código público do front-end
(`https://tn3.tse.jus.br/main.js`, SPA Angular) e da configuração pública do ambiente.
Nenhum login foi feito e nenhum dado pessoal foi consultado.

## Acesso

- `tn3.tse.jus.br` e `cad-api.tse.jus.br` respondem normalmente a partir do Brasil.
  De fora do país (ou de datacenters) a resposta é HTTP 403 (Akamai).
- O MCP, portanto, precisa rodar na máquina do usuário, no Brasil.

## Fluxo da consulta

O "Onde votar" **exige login**. Não há consulta anônima.

1. **Configuração** (pública):
   `POST https://cad-api.tse.jus.br/eleitor-servico/services/eleitoral/v1/ambiente/configuracao/consultar`
   com corpo `["TN3","ELO"]` e o cabeçalho `API-Authorization`.
2. **Login** (OAuth2, `grant_type=password`):
   `POST https://cad-api.tse.jus.br/eleitor-oauth/oauth/token`, form-urlencoded, com os campos
   - `cpf` **ou** `inscricao` (número do título), ou ainda `nome`;
   - `dataNascimento`;
   - `filiacoes` (nome da mãe e/ou do pai, separados por vírgula);
   - `token_captcha` (resposta do **hCaptcha**).

   Cabeçalhos: `API-Authorization` e `Authorization: Basic <client do front>`.
   A resposta traz o token de acesso (Bearer).
3. **Onde votar**:
   `POST https://cad-api.tse.jus.br/eleitor-servico/services/eleitoral/v3/eleitores/onde-votar`
   com corpo `{}`. O eleitor é identificado pelo token. Cabeçalhos: `Authorization: Bearer <token>`,
   `API-Authorization`, `sistema: tn3-web`, `usuario: tn3-web`.

As credenciais do client (API-Authorization e Basic) estão embutidas no JavaScript público
do site. **Não devem ser copiadas para este repositório.**

### Resposta (campos usados pelo front)

- `ondeVotara`: `zona`, `secao`, `numeroLocal`, `nome` (local), `endereco`, `bairro`,
  `municipio`, `uf` (`ZZ` = exterior), `latitude`, `longitude`;
- `domicilioEleitoral`: mesma estrutura, usada no lugar de `ondeVotara` em alguns casos;
- `eleitor`: `nomeCivil`, `nomeSocial`, `inscricao`;
- `mensagens`: avisos, por exemplo título cancelado ou suspenso;
- dados de situação do título.

## Captcha

A configuração de produção (consultada em 09/10/2026) informa:

| Chave | Valor |
|---|---|
| `PROPRIEDADE.ELEITOR-OAUTH.CAPTCHA-HABILITADO` | `HCAPTCHA` |
| `PROPRIEDADE.ELEITOR-OAUTH.CAPTCHA-GOOGLE-HABILITADO` | `true` |

Ou seja, **o login exige hCaptcha**. A chave de site do hCaptcha está vinculada ao domínio
do TSE, então o widget não pode ser exibido em outra página (ex.: localhost).
Este projeto **não vai contornar o captcha** (nem por serviços de resolução automática).

## Outros achados úteis

Endpoints do mesmo front que podem servir a serviços futuros (a confirmar se exigem login):

- `estruturaje-servico/.../v3/zonas/consultar`, `v1/unidades/consultar`,
  `v2/centrais-atendimento/consultar`: zonas, cartórios e centrais de atendimento;
- `eleitor-servico/.../v1/eleitores/locais-votacao/consultar`: locais de votação;
- `eleitor-servico/.../v5/eleitores/situacao-eleitoral`: situação eleitoral (com login).

A configuração pública também traz o cronograma de suspensões (ex.: Título Net suspenso de
07/05 a 02/11/2026; certidão de quitação suspensa de 05/10 a 11/10/2026). Isso pode virar
uma ferramenta própria ("o serviço X está disponível hoje?").

## Caminhos possíveis

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **A. Zona e seção informadas** (já funciona) | O usuário informa zona/seção (do e-Título ou do título) e a ferramenta `buscar_locais_votacao` mostra o local | Sem login, sem dados pessoais | O usuário precisa saber zona/seção |
| **B. Navegador assistido** | O MCP abre o tn3 num navegador visível (Playwright); o próprio usuário faz login e resolve o captcha; o MCP lê a resposta do onde-votar | Resposta oficial e completa; captcha resolvido por humano | Dependência pesada (navegador); quebra se o front mudar; dados pessoais passam pelo MCP |
| **C. Acesso oficial** | Pedir ao TSE um client de integração (sem captcha, com cota/autorização) | Robusto e sustentável | Depende de aprovação institucional |
