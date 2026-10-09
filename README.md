# mcp-eleitoral

Servidor [MCP](https://modelcontextprotocol.io) para serviços da Justiça Eleitoral
brasileira (TSE). Oferece os **locais de votação**, com base nos dados abertos
oficiais, e a consulta **"Onde votar"** de um eleitor no Autoatendimento Eleitoral.
Foi estruturado para receber outros serviços (situação eleitoral, certidões…).

> Projeto independente, sem vínculo com o TSE.

## O que dá para perguntar

| Pergunta | Ferramenta |
|---|---|
| Quantos locais de votação há no Brasil? E no DF? E no exterior? E em Nova York? | `contar_locais_votacao` |
| Quais cidades do exterior têm mais locais? Quantos locais por zona no DF? | `contar_locais_votacao` com `agrupar_por` |
| Onde fica a seção 579 da zona 1 do DF? Quais locais há na Asa Sul? | `buscar_locais_votacao` |
| Qual o local de votação mais perto daqui / da casa do meu pai? | `locais_votacao_proximos` (com endereço ou CEP) |
| Onde eu voto? Qual a minha zona e seção? Meu título está regular? | `onde_votar` (e `onde_votar_continuar`, se houver verificação) |

Sobre proximidade: o servidor não sabe onde o usuário está. O modelo pede um endereço,
CEP ou coordenadas, e o endereço é convertido em coordenadas pelo
[Nominatim/OpenStreetMap](https://nominatim.org). A distância é em linha reta, e o
local onde a pessoa vota é definido pela zona e seção do título, não pela proximidade.
Locais do exterior não têm coordenadas na base do TSE.

## Consulta "Onde votar"

A ferramenta `onde_votar` faz o que o eleitor faria no navegador: abre a página oficial
(https://tn3.tse.jus.br), preenche o login com CPF, título ou nome, data de nascimento e
nome da mãe, e lê a resposta do TSE (local, endereço, zona, seção e situação do título).

- Requer **Google Chrome ou Microsoft Edge** instalado e acesso a partir do Brasil.
- A consulta roda num navegador **invisível**. O hCaptcha do TSE é respeitado: se ele
  exigir uma verificação humana, abre-se uma janela visível para o próprio usuário
  resolver, e a IA conclui com `onde_votar_continuar`.
- Uso individual: só para o próprio eleitor ou com autorização dele. Uma consulta por vez.
- Nenhum dado pessoal vai para logs; o perfil do navegador é temporário e descartado.

Detalhes em [`docs/implementacao-onde-votar.md`](docs/implementacao-onde-votar.md).

## Dados

- Fonte: [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br) — *Eleitorado - Locais de votação*
  (`eleitorado_local_votacao_<ano>.zip`). Por padrão usa o ano mais recente publicado.
- Na primeira execução o servidor baixa o .zip (~175 MB), agrega as seções por local
  e grava um JSON (~40 MB) em `~/.cache/mcp-eleitoral/`. Isso leva cerca de 1 minuto.
  Depois disso a carga é instantânea.
- Para baixar a base antecipadamente ou atualizá-la: `npm run dados:atualizar [ano]`.

## Instalação

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add eleitoral -- node /caminho/para/mcp-eleitoral/dist/index.js
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "eleitoral": {
      "command": "node",
      "args": ["/caminho/para/mcp-eleitoral/dist/index.js"]
    }
  }
}
```

### Variáveis de ambiente (opcionais)

| Variável | Uso |
|---|---|
| `MCP_ELEITORAL_ANO` | Fixa o ano da base de locais (ex.: `2024`) |
| `MCP_ELEITORAL_CACHE_DIR` | Diretório do cache das bases |
| `MCP_ELEITORAL_NOMINATIM_URL` | Outra instância do Nominatim |
| `MCP_ELEITORAL_USER_AGENT` | User-Agent das requisições (recomendado incluir um contato) |
| `MCP_ELEITORAL_NAVEGADOR` | Navegador do onde votar: `chrome`, `msedge` ou caminho do executável (padrão: Chrome, depois Edge) |

## Desenvolvimento

```bash
npm run dev         # servidor via tsx (stdio)
npm test            # testes (vitest), com amostra real do CSV do TSE e navegador falso
npm run typecheck
npm run inspector   # abre o MCP Inspector
```

## Estrutura

```
src/
  index.ts                  # entrada: stdio + pré-carga da base
  server.ts                 # cria o McpServer e registra os serviços
  contexto.ts               # dependências compartilhadas (injeção p/ testes)
  lib/                      # http, geo (haversine), texto, config, respostas
  services/
    index.ts                # lista de serviços registrados
    locais-votacao/         # dados abertos: download, agregação, consultas, ferramentas
    geocoding/              # endereço/CEP → coordenadas (Nominatim)
    onde-votar/             # consulta individual no tn3 via navegador (Playwright)
docs/
  investigacao-onde-votar.md  # como o serviço do TSE funciona
  implementacao-onde-votar.md # desenho, status e pendências
```

Para adicionar um serviço, crie `src/services/<servico>/ferramentas.ts` com uma função
`registrar…(server, ctx)` e inclua-a em `src/services/index.ts`.

## Próximos passos

- [x] Consulta "Onde votar" individual (tn3.tse.jus.br)
- [ ] Validar o onde votar com uma consulta real (ver pendências em
      [`docs/implementacao-onde-votar.md`](docs/implementacao-onde-votar.md))
- [ ] Geocodificar os endereços do exterior para permitir busca por proximidade fora do Brasil
- [ ] Outros serviços: situação eleitoral, certidão de quitação, resultados de eleições
