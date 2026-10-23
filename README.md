# Córtex — seu segundo cérebro local

Um cérebro animado, feito de milhares de triângulos de luz, onde moram as suas ideias, planos e projetos. Roda no seu computador em `http://localhost:3333`, guarda tudo como arquivos Markdown e se conecta ao Claude, que lê, organiza e cria nós por você.

- **Base do cérebro (CLAUDE.MD):** o índice que o Claude lê. Clique nele para ver como conectar.
- **Áreas:** os grandes temas da sua vida (Trabalho, Estudos, Saúde…), em volta do cérebro, cada uma ligada à sua região.
- **Projetos:** círculos com as iniciais. **Planos:** anéis laranja. **Ideias:** pontos.
- Clicar em qualquer ícone aproxima e centraliza nele.

Tudo fica em `cerebro/nos/`, um arquivo por nó. Você pode editar no mapa, no seu editor ou pedindo ao Claude; o mapa atualiza sozinho.

## 1. Rodar

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo (`node -v`). Não há dependências para instalar.

```bash
git clone https://github.com/andrecavalcantii/cortex.git
cd cortex
npm start
```

Abra http://localhost:3333. A pasta `cerebro/` nasce vazia na primeira vez; escreva uma ideia na barra de baixo e aperte Enter.

Opcional: copie `.env.example` para `.env` e diga quem você é (`CORTEX_DONO`, `CORTEX_SOBRE`). O Claude usa isso para saber com quem está falando.

## 2. Ligar ao Claude

São três jeitos, e dá para usar todos ao mesmo tempo.

### A. Claude Desktop ou Claude Code (MCP), sem chave de API

Na pasta do Córtex, rode uma vez:

```bash
npm run setup-claude
```

O comando adiciona o Córtex ao `claude_desktop_config.json` (guardando uma cópia do arquivo antigo em `.bak`) e, se o Claude Code estiver instalado, configura ele também, para todas as pastas. Depois feche o Claude Desktop por completo e abra de novo.

A partir daí, é só conversar: *"tive uma ideia: …"*, *"lê meu Córtex e me diz o que priorizar essa semana"*, *"transforma essa ideia num plano de 4 semanas e conecta ao projeto"*. O Claude ganha as ferramentas `listar_nos`, `ler_no`, `buscar`, `criar_no`, `atualizar_no` e `conectar_nos`. Ele não apaga nós.

**Configuração manual**, se preferir — no `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/caminho/completo/para/cortex/mcp.js"]
    }
  }
}
```

No Claude Code: `claude mcp add --scope user cortex -- node /caminho/completo/para/cortex/mcp.js`

### B. Chat dentro da página (API)

1. Crie uma chave em https://console.anthropic.com (a API é paga à parte do plano do claude.ai).
2. No `.env`, preencha `ANTHROPIC_API_KEY=sk-ant-...`.
3. Reinicie com `npm start`.

Liga a aba **Claude** do painel e a opção **"Claude organiza e conecta"** da barra de captura.

### C. Abrir a pasta no Claude Code

```bash
cd cortex/cerebro
claude
```

O Claude lê o `CLAUDE.md` automaticamente e entende o formato dos nós.

## 3. Backup das suas anotações

Suas anotações ficam fora deste repositório (`cerebro/` está no `.gitignore`), então elas nunca vão para o GitHub junto com o código. Para ter histórico e backup delas:

1. No GitHub, crie um repositório **privado** e **vazio**, por exemplo `cortex-cerebro`.
2. Na pasta do Córtex:
   ```bash
   npm run backup -- https://github.com/SEU_USUARIO/cortex-cerebro.git
   ```
3. Reinicie o servidor (`Ctrl + C` e `npm start`).

Daí em diante, uns 20 segundos depois de cada mudança, o servidor faz um commit de `cerebro/` e envia ao GitHub. Clique no núcleo CLAUDE.MD do mapa para ver o último backup. Sem a URL (`npm run backup`), o histórico fica só no computador.

## 4. Navegar no mapa

- **Roda do mouse** ou **pinça** no celular: zoom no ponto do cursor.
- **Arrastar** o fundo: move o mapa. **Duplo clique** no vazio: aproxima.
- Botões **+ − ⌖** na lateral; teclas `+`, `-`, `0` para centralizar e `Esc` para fechar o painel.

## Formato de um nó

`cerebro/nos/meu-projeto.md`:

```markdown
---
title: Meu projeto
type: projeto          # ideia | plano | projeto
area: Trabalho
status: ativo          # semente | ativo | pausado | feito
links: [outra-ideia, um-plano]
created: 2026-01-10T12:00:00.000Z
updated: 2026-01-10T12:00:00.000Z
---

Notas em Markdown…
```

## Configuração (`.env`)

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `CORTEX_DONO`, `CORTEX_SOBRE` | Quem é você, para o Claude | vazio (texto neutro) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Chat dentro da página | desligado |
| `PORT` | Porta do mapa | `3333` |
| `CORTEX_DIR` | Outra pasta de anotações | `./cerebro` |

O servidor só aceita conexões do próprio computador (127.0.0.1).

## Licença

[MIT](LICENSE).
