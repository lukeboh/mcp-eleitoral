# Implementação: consulta "Onde votar"

Status em 09/10/2026: **em andamento**. A investigação do serviço está em
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
| `src/services/onde-votar/credenciais.ts` | normaliza CPF (com verificação dos dígitos), título (12 dígitos) ou nome completo; data de nascimento em `dd/mm/aaaa`, `aaaa-mm-dd` ou `ddmmaaaa` (devolve `ddmmaaaa`, como a máscara do site); nome da mãe | feito, sem testes |
| `src/services/onde-votar/resposta.ts` | converte a resposta de `v3/eleitores/onde-votar` (`ondeVotara` ou `domicilioEleitoral`, `eleitor`, `situacaoEleitoral`, `mensagens`) no formato do MCP, repassando só campos conhecidos; trata exterior (`uf = ZZ`, país em `bairro`) e coordenadas ausentes; gera link de mapa | feito, sem testes |

## O que falta

### Código

1. **`src/services/onde-votar/navegador.ts`**: abrir Chrome ou Edge via `playwright-core`
   (`channel: "chrome"`, depois `"msedge"`, ou o valor de `MCP_ELEITORAL_NAVEGADOR`),
   invisível ou visível, num contexto novo (`locale pt-BR`, fuso `America/Sao_Paulo`).
2. **`src/services/onde-votar/consulta.ts`**: classe `ServicoOndeVotar` com o fluxo acima:
   fila de uma consulta por vez, as duas tentativas, sessões pendentes com expiração,
   `continuar(sessao)` e `encerrar()`.
3. **`src/services/onde-votar/ferramentas.ts`**: ferramentas MCP `onde_votar` e
   `onde_votar_continuar`, com descrições que orientem a IA (dados vêm da própria pessoa;
   o que fazer com `desafio_pendente`). Opcional: enriquecer o resultado com a base de
   dados abertos (acessibilidade, total de eleitores do local) via zona e seção.
4. **Integração**: incluir `ondeVotar` no `Contexto` (`src/contexto.ts`), registrar em
   `src/services/index.ts`, criar o serviço em `src/index.ts` e fechar navegadores
   abertos quando o processo terminar.
5. **Configuração**: `navegadorConfigurado()` em `src/lib/config.ts` (variável
   `MCP_ELEITORAL_NAVEGADOR`) e documentação no `README.md`.

### Testes

- Unitários de `credenciais.ts` (CPF válido/inválido, formatos de data, nome curto).
- Unitários de `resposta.ts` com uma resposta **fictícia** (Brasil e exterior).
- `ServicoOndeVotar` com um navegador falso (injeção de `AbrirNavegador`), cobrindo:
  sucesso direto, erro de login, desafio resolvido e desafio expirado.
- Teste manual de ponta a ponta feito pelo próprio eleitor, com os dados dele.

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

- A escrita de `navegador.ts` e `consulta.ts` foi bloqueada pelo classificador do modo
  automático do Claude Code, porque o código automatiza um login protegido por captcha.
  Para continuar, liberar a escrita em `src/services/onde-votar/` em
  `.claude/settings.json` (ver abaixo) ou aprovar o pedido de permissão.

```json
{
  "permissions": {
    "allow": [
      "Write(src/services/onde-votar/**)",
      "Edit(src/services/onde-votar/**)"
    ]
  }
}
```
