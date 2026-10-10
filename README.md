# mcp-eleitoral

Servidor [MCP](https://modelcontextprotocol.io) para serviços da Justiça Eleitoral
brasileira (TSE). Começa pelos **locais de votação**, com base nos dados abertos
oficiais, e foi estruturado para receber outros serviços (consulta "onde votar",
situação eleitoral, certidões…).

> Projeto independente, sem vínculo com o TSE.

## O que dá para perguntar

| Pergunta | Ferramenta |
|---|---|
| Quantos locais de votação há no Brasil? E no DF? E no exterior? E em Nova York? | `contar_locais_votacao` |
| Quais cidades do exterior têm mais locais? Quantos locais por zona no DF? | `contar_locais_votacao` com `agrupar_por` |
| Onde fica a seção 579 da zona 1 do DF? Quais locais há na Asa Sul? | `buscar_locais_votacao` |
| Qual o local de votação mais perto daqui / da casa do meu pai? | `locais_votacao_proximos` (com endereço ou CEP) |

Sobre proximidade: o servidor não sabe onde o usuário está. O modelo pede um endereço,
CEP ou coordenadas, e o endereço é convertido em coordenadas pelo
[Nominatim/OpenStreetMap](https://nominatim.org). A distância é em linha reta, e o
local onde a pessoa vota é definido pela zona e seção do título, não pela proximidade.
Locais do exterior não têm coordenadas na base do TSE.

## Bases de dados e downloads

As ferramentas consultam bases do [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br),
baixadas sob demanda e guardadas em `~/.cache/mcp-eleitoral/` (CSV processado para JSON ou SQLite).
Os tamanhos vão de 0,1 MB a mais de 1 GB, por isso:

- **Aviso de tamanho e confirmação.** Se uma pergunta precisa de uma base que ainda não está no disco,
  a ferramenta responde com o nome da base e o **tamanho do download**, e o modelo pede confirmação ao
  usuário. Bases pequenas (até 10 MB, configurável) são baixadas automaticamente.
- **Download em segundo plano com acompanhamento.** `baixar_base` inicia o download e retorna na hora;
  `progresso_downloads` mostra fase (baixando/processando), percentual, velocidade e tempo restante.
  Com `aguardar=true`, a ferramenta espera e envia **notificações de progresso MCP**
  (`notifications/progress`), exibidas pelos clientes que as suportam.
- **Gestão do espaço.** `listar_bases` mostra o catálogo com tamanho de download, situação, espaço em disco
  e se há atualização no TSE; `remover_base` apaga uma base.

| Ferramenta | Uso |
|---|---|
| `listar_bases` | Catálogo, tamanhos, situação e espaço em disco (para bases por UF, o tamanho de cada estado) |
| `baixar_base` | Baixa uma base depois da confirmação do usuário (`atualizar=true` para baixar de novo) |
| `progresso_downloads` | Andamento dos downloads |
| `remover_base` | Libera espaço |

Pelo terminal, com barra de progresso:

```bash
npm run dados -- listar
npm run dados -- info votacao-secao --ano 2026        # tamanho por UF
npm run dados -- baixar locais-votacao                # pede confirmação
npm run dados -- baixar votacao-secao --uf DF --sim
npm run dados -- remover locais-votacao
```

## Instalação

Requer Node.js 22.13 ou superior (usa o SQLite embutido, `node:sqlite`).

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
| `MCP_ELEITORAL_DOWNLOAD_AUTOMATICO_MB` | Tamanho máximo baixado sem pedir confirmação (padrão `10`) |
| `MCP_ELEITORAL_CACHE_DIR` | Diretório do cache das bases |
| `MCP_ELEITORAL_NOMINATIM_URL` | Outra instância do Nominatim |
| `MCP_ELEITORAL_USER_AGENT` | User-Agent das requisições (recomendado incluir um contato) |

## Desenvolvimento

```bash
npm run dev         # servidor via tsx (stdio)
npm test            # testes (vitest), com amostras reais dos arquivos do TSE em tests/fixtures/tse
npm run typecheck
npm run inspector   # abre o MCP Inspector
```

## Estrutura

```
src/
  index.ts                  # entrada: stdio + abertura das bases já baixadas
  server.ts                 # cria o McpServer e registra os serviços
  contexto.ts               # dependências compartilhadas (injeção p/ testes)
  dados/                    # gerenciador de bases: tamanho, download, progresso, cache, CSV→SQLite
  lib/                      # http, geo (haversine), texto, config, respostas
  services/
    index.ts                # serviços e bases registrados
    locais-votacao/         # base.ts (definição da base), consultas e ferramentas
    geocoding/              # endereço/CEP → coordenadas (Nominatim)
    onde-votar/             # consulta individual (pendente: ver docs/)
docs/investigacao-onde-votar.md
```

Para adicionar um serviço, crie `src/services/<servico>/` com `base.ts` (uma `DefinicaoBase`:
URL, processamento do .zip e abertura) e `ferramentas.ts` (`registrar…(server, ctx)`), e inclua
ambos em `src/services/index.ts`. As ferramentas obtêm a base com `ctx.bases.obter(id, { ano, uf })`;
o gerenciador cuida do aviso de tamanho, do download e do progresso.

## Próximos passos

- [ ] Consulta "Onde votar" individual (tn3.tse.jus.br), após a investigação descrita em
      [`docs/investigacao-onde-votar.md`](docs/investigacao-onde-votar.md)
- [ ] Geocodificar os endereços do exterior para permitir busca por proximidade fora do Brasil
- [ ] Outros serviços: situação eleitoral, certidão de quitação, resultados de eleições
