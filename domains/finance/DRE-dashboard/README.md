# Atualização Dashboard Financeiro

Workflow n8n que sincroniza dados financeiros de uma planilha Google Sheets para um banco PostgreSQL, alimentando um dashboard HTML de fluxo de caixa em tempo quase real.

---

## Arquivos do repositório

| Arquivo | Descrição | Link |
|---------|-----------|------|
| `Atualização_Dashboard_financeiro.json` | Workflow n8n — importar diretamente | [📥 Baixar](https://raw.githubusercontent.com/seu-usuario/seu-repositorio/main/Atualização_Dashboard_financeiro.json) |
| `script_Planilha.js` | Macro Google Apps Script — colar no GAS | [📄 Ver arquivo](https://github.com/seu-usuario/seu-repositorio/blob/main/script_Planilha.js) |
| `index.html` | Dashboard HTML — abrir no navegador | [📄 Ver arquivo](https://github.com/seu-usuario/seu-repositorio/blob/main/index.html) |

---

## Visão geral da arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         n8n Orchestrator                            │
│                                                                     │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐   │
│  │ScheduleTrigger│───▶│  HTTP GET       │───▶│  Limpar tabelas  │   │
│  │ (a cada 5min) │    │  Apps Script    │    │  (TRUNCATE PG)   │   │
│  └──────────────┘    └─────────────────┘    └────────┬─────────┘   │
│                                                       │             │
│  ┌─────────────────────────────────────────────────── ▼ ─────────┐ │
│  │                   Code Node (JS)                               │ │
│  │  Lê data.daily → gera rows {categoria, banco, status, valor,  │ │
│  │  data_mov, mes} → retorna array para inserção                  │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                     │
│                    ┌──────────▼──────────┐                          │
│                    │  Inserir transações  │                          │
│                    │  (Postgres INSERT)   │                          │
│                    └──────────┬──────────┘                          │
│                               │                                     │
│                    ┌──────────▼──────────┐                          │
│                    │  Registrar sucesso   │                          │
│                    │  (sync_log INSERT)   │                          │
│                    └─────────────────────┘                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────┐                       │
│  │ Error Trigger│───▶│  Registrar erro       │                       │
│  │              │    │  (sync_log INSERT)    │                       │
│  └──────────────┘    └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
        │
        │  lê direto via APPS_SCRIPT_URL
        ▼
┌───────────────────┐        ┌─────────────────────┐
│  Dashboard HTML   │        │   Google Sheets      │
│  (index.html)     │◀───────│   + Apps Script (GAS)│
│  Chart.js frontend│  JSON  │   Macro publicada    │
└───────────────────┘        └─────────────────────┘
```

> **Nota sobre o fluxo de dados:** O dashboard HTML **não** lê do PostgreSQL diretamente.  
> Ele consome a mesma URL do Apps Script que o n8n usa. O PostgreSQL serve como camada de persistência e histórico para integrações futuras ou relatórios externos.

---

## Como funciona a macro Google Apps Script

A macro (`script_Planilha.js`) é um **Google Apps Script** vinculado a uma planilha do Google Sheets e **publicado como Web App** com acesso público (`Execute as: Me`, `Who has access: Anyone`).

Quando publicado, o Google gera uma URL pública no formato:
```
https://script.google.com/macros/s/<ID_DA_MACRO>/exec
```

Ao receber uma requisição HTTP GET nessa URL, o script executa `doGet()` e retorna um JSON com todos os dados financeiros processados. **Não é necessário autenticação** — o acesso é anônimo via URL pública.

### O que a macro faz, passo a passo

**1. Leitura da planilha**  
Abre a aba configurada em `SHEET_NAME` e lê todas as linhas. Detecta automaticamente as colunas pelos cabeçalhos (busca por `categoria`, `banco`, `status`, `valor`, `data`, `saldo total`), tornando o script resiliente a reordenação de colunas.

**2. Separação de transações operacionais**  
Filtra linhas de controle interno (saldo, aplicações automáticas, rendimentos) via regex — `isBalance()` — mantendo apenas as transações reais de entrada e saída.

**3. Categorização automática**  
Classifica cada transação por palavras-chave no campo `categoria`:

| Palavra-chave detectada | Categoria atribuída |
|-------------------------|---------------------|
| TRIBUT, IMPOSTO, FGTS, INSS, IRRF | Tributos |
| FORNECEDOR, SISPAG | Fornecedores |
| GIRO PARCEL, EMPRESTIMO, FINANC | Financeiro |
| TAR, TED, PIX, IOF | Tarifas Bancárias |
| SAQUE, ATM | Saques |
| MOV TIT COB, COBRAN | Rec. Clientes |
| SALARIO, FOLHA, RH | Pessoal |
| *(sem match)* | Outros |

**4. Agregações calculadas**  
A macro devolve no JSON todos os dados já processados:
- `totalRec` / `totalPag` / `resultado` — totais gerais
- `byMonth` — receitas e pagamentos agrupados por mês
- `catPag` / `catRec` — totais por categoria
- `topPag` / `topRec` — top 10 pagadores e recebedores
- `daily` — série diária (até 60 pontos) com entradas (`r`) e saídas (`p`) por data
- `saldoInicial` — primeiro saldo total encontrado na planilha
- `meses` — lista ordenada dos meses presentes

**5. Resposta JSON**  
```json
{
  "status": "ok",
  "data": { ... },
  "updated": "2025-01-15T10:30:00.000Z"
}
```
Em caso de erro, retorna `{ "status": "error", "message": "..." }`.

---

## Fluxo do workflow n8n — nó a nó

### 1. `A cada 5 minutos` — Schedule Trigger
Dispara o workflow automaticamente a cada 5 minutos. Pode ser ajustado para qualquer intervalo conforme a necessidade de atualização do dashboard.

### 2. `Buscar Apps Script` — HTTP Request (GET)
Faz um **GET** na URL pública da macro do Google Apps Script. Aguarda até 30 segundos pela resposta (`timeout: 30000`). A URL tem o formato:
```
https://script.google.com/macros/s/<ID_DA_MACRO>/exec
```
Retorna o JSON completo com todos os dados financeiros já processados pela macro.

### 3. `Limpar tabelas` — Postgres (executeQuery)
Antes de inserir novos dados, limpa completamente as tabelas para evitar duplicatas:
```sql
TRUNCATE TABLE transacoes RESTART IDENTITY CASCADE;
TRUNCATE TABLE saldo_inicial RESTART IDENTITY CASCADE;
```
O `RESTART IDENTITY` reseta os IDs auto-incrementais. O `CASCADE` garante que views e dependências não bloqueiem a operação.

### 4. `Processar dados` — Code (JavaScript)
Recebe o JSON do nó `Buscar Apps Script` (via referência `$('Buscar Apps Script').first().json`) e transforma `data.daily` em linhas individuais para a tabela `transacoes`. Cada entrada diária vira até duas linhas: uma de `Recebimento` e uma de `Pagamento`. Valida `json.status === 'ok'` antes de processar — em caso de erro, lança exceção que aciona o Error Trigger.

### 5. `Inserir transações` — Postgres (Insert)
Insere todas as linhas geradas na tabela `transacoes` com os campos:

| Campo | Origem |
|-------|--------|
| `categoria` | Fixo: `Recebimento Operacional` ou `Pagamento Operacional` |
| `banco` | Fixo: `Itaú` |
| `status` | `Recebimento` ou `Pagamento` |
| `valor` | Positivo para recebimentos, negativo para pagamentos |
| `data_mov` | Data no formato `DD/MM` |
| `mes` | Mês extraído da data (`MM`) |

### 6. `Registrar sucesso` — Postgres (executeQuery)
Ao final do pipeline, registra o resultado na tabela de auditoria:
```sql
INSERT INTO sync_log (status, rows_synced)
VALUES ('success', (SELECT COUNT(*) FROM transacoes));
```

### 7. `Error Trigger` + `Registrar erro`
Captura qualquer falha em qualquer nó do workflow e persiste a mensagem de erro no `sync_log`:
```sql
INSERT INTO sync_log (status, error_msg)
VALUES ('error', '{{ $json.message }}');
```

---

## Dashboard HTML (`index.html`)

Interface de visualização financeira construída em HTML/CSS/JS puro, usando **Chart.js 4.4** para os gráficos.

**O dashboard lê diretamente da URL do Apps Script** — não consulta o PostgreSQL. A variável de configuração fica no topo do `<script>`:

```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/<ID_DA_MACRO>/exec';
const AUTO_REFRESH_MINUTES = 5; // 0 para desativar o auto-refresh
```

### Páginas / seções

| Aba | Conteúdo |
|-----|----------|
| **Visão Geral** | KPIs (Total Recebido, Total Pago, Resultado, Saldo Inicial), gráfico mensal de barras, gráfico de resultado mensal, gráfico de pizza por categoria de pagamentos |
| **DRE** | Demonstrativo de Resultado simplificado com filtro por mês, com colunas de valor e % sobre receita |
| **Fluxo de Caixa** | Gráfico diário de entradas/saídas, saldo líquido acumulado, volume de transações por mês |
| **Detalhamento** | Top 10 pagamentos, Top 10 recebimentos, barras horizontais por categoria |

---

## Integrações

| Serviço | Tipo | Papel |
|---------|------|-------|
| Google Sheets | Planilha | Fonte primária dos dados financeiros |
| Google Apps Script | Web App (GAS) | Processa e expõe os dados via GET |
| n8n | Orquestrador | Sincroniza os dados para o PostgreSQL |
| PostgreSQL | Banco de dados | Persiste transações e log de sincronização |
| Dashboard HTML | Frontend | Visualiza os dados consumindo o Apps Script |

---

## Estrutura de banco de dados necessária

```sql
-- Tabela principal de transações
CREATE TABLE transacoes (
  id         SERIAL PRIMARY KEY,
  categoria  VARCHAR NOT NULL,
  banco      VARCHAR,
  status     VARCHAR NOT NULL,
  valor      NUMERIC NOT NULL,
  data_mov   VARCHAR,
  mes        VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de saldo inicial (usada para reset a cada ciclo)
CREATE TABLE saldo_inicial (
  id    SERIAL PRIMARY KEY,
  valor NUMERIC
);

-- Log de sincronizações
CREATE TABLE sync_log (
  id          SERIAL PRIMARY KEY,
  status      VARCHAR NOT NULL,
  rows_synced INTEGER,
  error_msg   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Configuração e instalação

### Pré-requisitos
- n8n (self-hosted ou cloud)
- PostgreSQL acessível pelo n8n
- Planilha Google Sheets com as colunas: `Categoria`, `Banco`, `Status`, `Valor`, `Data`, `Saldo Total`
- Google Apps Script publicado como Web App com acesso público

### Publicar o Apps Script

1. Abra a planilha no Google Sheets
2. Vá em **Extensões → Apps Script**
3. Cole o conteúdo de `script_Planilha.js`
4. Ajuste `SHEET_NAME` para o nome exato da sua aba
5. Clique em **Implantar → Nova implantação**
6. Tipo: `App da Web` · Executar como: `Eu` · Quem tem acesso: `Qualquer pessoa`
7. Copie a URL gerada — ela será usada no n8n e no `index.html`

### Importar o workflow no n8n

1. No n8n, clique em **Add workflow → Import from file**
2. Selecione `Atualização_Dashboard_financeiro.json`
3. Configure a credencial PostgreSQL nos nós marcados em vermelho
4. No nó **Buscar Apps Script**, substitua a URL pela URL real da sua macro
5. Execute manualmente uma vez para validar
6. Ative o workflow

### Configurar o dashboard

Edite o `index.html` e substitua a URL na constante:
```javascript
const APPS_SCRIPT_URL = 'COLE_A_URL_DA_SUA_MACRO_AQUI';
```

Abra o arquivo no navegador — ou hospede em qualquer servidor estático.

---

## Personalização

| O que ajustar | Onde |
|---------------|------|
| Intervalo de atualização do n8n | Nó `A cada 5 minutos` → campo `minutes` |
| Nome do banco na planilha | Nó `Processar dados` → campo `banco: 'Itaú'` |
| Filtros de linhas não-operacionais | `script_Planilha.js` → função `isBalance()` |
| Categorização de transações | `script_Planilha.js` → função `categorize()` |
| Auto-refresh do dashboard | `index.html` → constante `AUTO_REFRESH_MINUTES` |
| Nome da aba da planilha | `script_Planilha.js` → constante `SHEET_NAME` |

---

## Segurança

- Remova a URL real do Apps Script do `index.html` antes de versionar em repositórios públicos — use uma variável de ambiente ou placeholder (`COLE_SUA_URL_AQUI`)
- A credencial do PostgreSQL não está no JSON do workflow — deve ser configurada manualmente após a importação
- O Apps Script publicado como público expõe os dados financeiros sem autenticação — considere adicionar um token de query string para ambientes de produção
- Restrinja o acesso ao PostgreSQL por IP quando possível

---

## Arquivos do projeto

```
.
├── Atualização_Dashboard_financeiro.json   # Workflow n8n (importar diretamente)
├── script_Planilha.js                      # Macro Google Apps Script (colar no GAS)
├── index.html                              # Dashboard HTML (abrir no navegador)
└── README.md                               # Este arquivo
```
