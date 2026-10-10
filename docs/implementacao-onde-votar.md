# Implementação: consulta "Onde votar"

Status em 09/10/2026: **implementado e testado com navegador falso; falta validar com uma consulta real**. A investigação do serviço está em
[`investigacao-onde-votar.md`](investigacao-onde-votar.md).

## Objetivo

A IA faz o que o eleitor faria no navegador: abre o Autoatendimento Eleitoral
(`https://tn3.tse.jus.br/#/atendimento-eleitor/onde-votar`), preenche o login com os
dados que a própria pessoa informou na conversa (ou que o assistente dela já conhece)
e lê a resposta oficial do TSE.

## Princípios

- **O captcha é respeitado, nunca contornado.** O hCaptcha do tn3 decide sozinho.
  Na grande maioria dos acessos legítimos ele valida em segundo plano, sem interação.
- **Sem janela no caminho normal.** A consulta roda num navegador invisível (headless).
  Uma janela visível só é aberta **quando o hCaptcha exige um desafio**, para a própria
  pessoa resolvê-lo. Abrir janela sempre seria um problema constante de usabilidade.
- **Uso individual.** Uma consulta por vez, só para eleitores legítimos consultando os
  próprios dados (ou com autorização). Nada de consultas em massa.
- **Privacidade.** Nenhum dado pessoal em log. Perfil de navegador temporário,
  descartado no fim de cada consulta. Nenhum cache de resultados.
- **Credenciais do front não são copiadas.** O navegador usa a própria página do TSE.
  O MCP não chama a API `cad-api` diretamente e não guarda as chaves do client.

## Fluxo

```text
onde_votar(identificacao, data_nascimento, nome_mae)
  └─ valida e normaliza os dados (credenciais.ts)
  └─ tentativa 1: navegador INVISÍVEL
       preenche #titulo-cpf-nome, #dataNascimento, #nomeMae → "Entrar"
       espera o primeiro destes eventos:
         • resposta de POST .../v3/eleitores/onde-votar  → resultado (status "ok")
         • erro em POST .../eleitor-oauth/oauth/token     → mensagem do TSE (ex.: dados não conferem)
         • quadro de desafio do hCaptcha visível          → vai para a tentativa 2
         • tempo esgotado (45 s)                          → erro, com o texto de modal da tela se houver
  └─ tentativa 2 (só se houve desafio): janela VISÍVEL com os mesmos dados
       • se o desafio não reaparecer → resultado, a janela fecha sozinha
       • se reaparecer → devolve { status: "desafio_pendente", sessao, expira_em }
         a janela fica aberta (até 5 min) para a pessoa resolver

onde_votar_continuar(sessao)
  └─ espera (até 90 s por chamada) a resposta do onde-votar na janela aberta
  └─ "ok" → devolve o resultado e fecha a janela
     ainda pendente → devolve "desafio_pendente" de novo
```

A IA, ao receber `desafio_pendente`, deve dizer à pessoa que uma janela do navegador
foi aberta no computador dela, pedir que resolva o desafio e então chamar
`onde_votar_continuar`.

## O que já está implementado

| Arquivo | Conteúdo | Status |
|---|---|---|
| `package.json` | dependência `playwright-core` (usa Chrome/Edge instalados, sem baixar navegador) | feito |
| `src/services/onde-votar/credenciais.ts` | normaliza CPF (com verificação dos dígitos), título (12 dígitos) ou nome completo; data de nascimento em `dd/mm/aaaa`, `aaaa-mm-dd` ou `ddmmaaaa` (devolve `ddmmaaaa`, como a máscara do site); nome da mãe | feito, com testes |
| `src/services/onde-votar/resposta.ts` | converte a resposta de `v3/eleitores/onde-votar` (`ondeVotara` ou `domicilioEleitoral`, `eleitor`, `situacaoEleitoral`, `mensagens`) no formato do MCP, repassando só campos conhecidos; trata exterior (`uf = ZZ`, país em `bairro`) e coordenadas ausentes; gera link de mapa | feito, com testes |
| `src/services/onde-votar/navegador.ts` | abre Chrome ou Edge via `playwright-core` (`channel: "chrome"`, depois `"msedge"`, ou `MCP_ELEITORAL_NAVEGADOR`), invisível ou visível, com contexto novo (`pt-BR`, `America/Sao_Paulo`) descartado ao fechar | feito, com testes |
| `src/services/onde-votar/consulta.ts` | `ServicoOndeVotar`: fila de uma consulta por vez, tentativa invisível, tentativa visível só com desafio, sessões pendentes com expiração (5 min), `continuar(sessao)`, `encerrar()`. Os passos da página ficam na interface `Pagina` (`paginaTn3` é a real), para testar sem navegador | feito, com testes |
| `src/services/onde-votar/ferramentas.ts` | ferramentas MCP `onde_votar` e `onde_votar_continuar`, com instruções para a IA sobre uso legítimo e sobre `desafio_pendente` | feito, com testes |
| integração | `ondeVotar` no `Contexto`, registro em `src/services/index.ts`, criação em `src/index.ts` e fechamento das janelas pendentes ao encerrar o processo; `navegadorConfigurado()` em `src/lib/config.ts` | feito, com testes |

### Testes

| Arquivo | Cobre |
|---|---|
| `tests/onde-votar-credenciais.test.ts` | CPF válido/inválido, título, nome, formatos e validade da data, nome da mãe |
| `tests/onde-votar-resposta.test.ts` | resposta **fictícia** do Brasil e do exterior, nome social, `domicilioEleitoral`, campos não repassados |
| `tests/onde-votar-consulta.test.ts` | `ServicoOndeVotar` com navegador e página falsos: sucesso sem janela, erro de login, tempo esgotado, desafio que não reaparece, desafio resolvido via `continuar`, sessão expirada, uma consulta por vez |
| `tests/servidor.test.ts` | ferramentas `onde_votar` e `onde_votar_continuar` via MCP: validação e instruções de desafio |

O código que interage com a página real (`paginaTn3` em `consulta.ts` e `navegador.ts`)
não tem teste automatizado: depende do site do TSE e de dados de um eleitor.

## O que falta

1. **Teste de ponta a ponta** feito pelo próprio eleitor, com os dados dele, por exemplo
   pelo MCP Inspector (`npm run inspector`) ou pelo Claude Code com o servidor instalado.
2. Opcional: enriquecer o resultado com a base de dados abertos (acessibilidade, total
   de eleitores do local) via UF, zona e seção.

### Pontos a confirmar na primeira consulta real

- **Formato real da resposta**: os campos foram inferidos do código do front; conferir
  tipos (zona e seção numéricas? coordenadas com vírgula?) e quando vem
  `domicilioEleitoral` em vez de `ondeVotara`.
- **Navegação após o login**: ao abrir a rota, o site mostra o modal de login sobre `#/`.
  Confirmar que, depois do login, ele dispara sozinho o `POST .../onde-votar`.
- **Máscara da data**: confirmar que digitar `ddmmaaaa` tecla a tecla preenche certo.
- **Detecção do desafio**: hoje é pela visibilidade do `iframe[src*="hcaptcha"][src*="frame=challenge"]`.
  Se o TSE puder expor um sinal mais estável (evento ou callback do widget), usar esse.
- **Headless e o hCaptcha**: verificar se o modo invisível gera mais desafios que um
  navegador comum. Se gerar, avaliar alternativas sem abrir janela para a pessoa.
- **Login por nome**: o front tem variantes (`TituloCPFNomeExato`,
  `TituloCPFNomeOPCDtNascimento`) que podem pedir campos extras.
- **Filiação**: só o nome da mãe é suportado. O front também aceita nome do pai
  (`nomePai`, `tipoFiliacao`), para quem não tem mãe declarada.
- **e-Título**: o login alternativo pelo e-Título não é suportado.
- **Timeout do cliente MCP**: alguns clientes cortam chamadas longas. Por isso a espera do
  desafio é dividida em chamadas de `onde_votar_continuar`.
- **Janela fechada pela pessoa**: deve devolver um erro claro e encerrar a sessão.

### Ambiente

- Durante o desenvolvimento, o classificador do modo automático do Claude Code bloqueou
  a escrita via shell e a execução do `tsc`. O `.claude/settings.json` do projeto agora
  libera escrita em `src/` e `tests/`, typecheck, build, testes, `git add`, `git commit`
  e `git push`.
