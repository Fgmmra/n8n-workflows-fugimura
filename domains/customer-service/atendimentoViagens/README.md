# 🤖 Agente de Atendimento via WhatsApp

Sistema de atendimento conversacional, operando via **WhatsApp Oficial Meta** integrado ao **Chatwoot**. O agente recebe mensagens de clientes, processa múltiplos formatos de mídia, mantém contexto da conversa, registra dados de interesse em planilha e executa follow-ups automáticos com leads sem resposta.

---

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| [`Oficial_Meta___chatwoot.json`](./Oficial_Meta___chatwoot.json) | Workflow principal — recebe mensagens, processa mídia, aciona o agente e responde via Chatwoot |
| [`Follow_Up.json`](./Follow_Up.json) | Workflow de follow-up — monitora leads sem retorno e envia mensagens de reativação |
| [`generic-buffer.json`](./generic-buffer.json) | Sub-workflow de buffering — agrupa mensagens rápidas consecutivas antes de processar |
| [`Tool_registra_dados.json`](./Tool_registra_dados.json) | Tool do agente — registra dados do cliente na planilha de controle e elimina duplicatas |

---

## 🏗️ Arquitetura

```
WhatsApp Oficial Meta
        │
        ▼ (webhook Chatwoot)
┌──────────────────────────────────────────────────────┐
│  Agaxtur V2 - Produção                               │
│                                                      │
│  Webhook → variaveis → verificaTipoMensagem          │
│                │                                     │
│      ┌─────────┼──────────┬───────────┐              │
│      ▼         ▼          ▼           ▼              │
│   texto     imagem    documento    áudio/vídeo        │
│      │         │          │           │              │
│      └─────────┴──────────┴───────────┘              │
│                │                                     │
│                ▼                                     │
│     unificaMessage (mensagem normalizada)            │
│                │                                     │
│                ▼                                     │
│     Buffering (generic-buffer) ◄── agrupa msgs       │
│                │                                     │
│                ▼                                     │
│     busca campanhas → Aggregate → context            │
│                │                                     │
│                ▼                                     │
│     Agaxtur Bot (AI Agent + Gemini)                  │
│        │              │                              │
│        ▼              ▼                              │
│   resposta        Tool: registra dados               │
│   Chatwoot          (planilha + follow-up)           │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Follow Up Agaxtur (Schedule — a cada 1 minuto)      │
│                                                      │
│  Schedule → Get rows → Filter (horário exato)        │
│    → verificar fim de semana                         │
│    → Loop → Redis (histórico) → AI Agent             │
│    → chatwootTexto → apaga da planilha               │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  generic-buffer (sub-workflow)                       │
│                                                      │
│  Trigger → Presets → Push (Redis) → Wait (11s)       │
│    → Get Last Content → Verificar nova mensagem      │
│    → Capturar lista → Delete buffered                │
└──────────────────────────────────────────────────────┘
```

---

## 📋 Workflows

### `Agaxtur V2 - Produção`

Workflow central do atendimento. Ativado por sinal paginado do Chatwoot a cada mensagem recebida.

```
Webhook (POST)
  → variaveis (Set)
      Extrai: recipientPhone, userMessage, messageType, url, conversationId
  → verificaTipoMensagem (Switch)
      ├── texto       → messageText
      ├── imagem      → Analyze image (Gemini)
      ├── documento   → Analyze document (Gemini)
      ├── áudio       → Analyze audio1 (Gemini) → audioTranscrito
      └── vídeo       → Analyze video (Gemini)
  → unificaMessage (Set)
      Consolida o conteúdo em campo único independente do tipo
  → Buffering (Execute Workflow: generic-buffer)
      Aguarda 11s e agrupa mensagens consecutivas do mesmo número
  → Confirmação de leitura (HTTP → Chatwoot)
  → busca campanhas (DataTable)
  → Aggregate → messageGemini
  → Busca mensagens da conversa (HTTP → Chatwoot)
  → Extrai última mensagem real (Code)
  → Tem mensagem válida? (If)
  → Agaxtur Bot (AI Agent — Gemini Flash)
      Memória: Redis Chat Memory (por conversationId)
      Tool: Tool registra dados (registra lead na planilha)
  → Switch (tipo de resposta)
      ├── texto  → chatwootTexto1 (HTTP → Chatwoot)
      └── áudio  → chatwootAudio1 (HTTP → Chatwoot)
```

**Registro de follow-up:** após o agente coletar os dados do cliente, a tool `salvar follow up` grava um registro na DataTable com horário programado para reativação.

---

### `Follow Up Agaxtur`

Workflow de acompanhamento automático. Varre a fila de follow-ups e envia mensagens de reativação para leads sem resposta, exceto fins de semana.

```
Schedule Trigger (a cada 1 minuto)
  → Get row(s) (DataTable: fila de follow-ups)
  → Filter
      Filtra registros cujo campo `horario` bate com o minuto atual (São Paulo)
  → Loop Over Items
      → numero (Set) — formata o número do destinatário
      → verificar se é fim de semana (If)
          TRUE  → apaga da planilha1 (sem envio)
          FALSE →
            → Redis (get) — recupera histórico da conversa
            → vars (Set) — prepara contexto das últimas 6 mensagens
            → AI Agent (Gemini)
                Analisa o histórico e gera uma mensagem de follow-up
                natural, sem inventar informações
            → chatwootTexto1 (HTTP → Chatwoot) — envia mensagem
            → apaga da planilha (DataTable) — remove da fila
      → Wait → próximo item
```

---

### `generic-buffer`

Sub-workflow de agrupamento de mensagens. Evita que o agente processe cada mensagem isoladamente quando o usuário envia várias em sequência rápida.

```
When Executed by Another Workflow
  Inputs: message, phoneNumber, delayTimeMs
  → Presets (Set)
      Define redisListKey: services:message-buffering:{phoneNumber}
  → Push Content (Redis PUSH)
      Empurra a mensagem atual para a lista do número
  → Wait (11 segundos)
  → Get Last Content (Redis GET)
      Lê o topo da lista — que pode conter mensagens mais novas
  → Verificar se há nova mensagem (If)
      Se o topo == mensagem original → não chegou mensagem nova → prossegue
      Se diferente → mensagem mais nova assumiu o controle → interrompe
  → Capturar lista de mensagens (Set)
      Inverte a lista e une com \n para reconstituir o fluxo cronológico
  → Delete Buffered Messages (Redis DELETE)
      Limpa a chave do Redis após consolidar
```

---

### `Tool registra dados`

Tool utilizada diretamente pelo agente. Registra os dados coletados na planilha de controle e garante que não haja duplicatas por número de telefone.

```
When Executed by Another Workflow
  Inputs: session_id, CLIENTE, E-MAIL, DESTINO, DATA VIAGEM, QT PAX, TEL PAX
  → Wait
  → apaga da planilha1 (DataTable)
      Remove registro anterior do mesmo número (TEL PAX)
  → Append or update row in sheet (Google Sheets)
      Upsert por session_id com STATUS = "novo"
      e DATA DE ENTRADA no fuso America/Sao_Paulo
```

**Registro exemplo:**

```json
{
  "session_id": "177",
  "CLIENTE": "Gustavo Bispo",
  "E-MAIL": "cliente@email.com",
  "DESTINO": "Índia",
  "DATA VIAGEM": "08/09",
  "QT PAX": "2",
  "TEL PAX": "+5511958751561",
  "STATUS": "novo",
  "DATA DE ENTRADA": "2025-07-01 14:32"
}
```

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| WhatsApp Oficial Meta | Canal de entrada de mensagens | Configurado via Chatwoot |
| Chatwoot | Gestão de conversas e envio de respostas | HTTP Request (API Key) |
| Google Gemini | LLM do agente e análise de mídia | Credencial Google Palm API |
| Redis | Buffering de mensagens e memória de chat | Credencial Redis |
| Google Sheets | Planilha de controle de leads | OAuth2 Google Sheets |
| n8n DataTable | Fila de follow-ups e dados temporários | Interno n8n |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted)
- Número WhatsApp Oficial Meta conectado ao Chatwoot
- Instância Redis acessível pela instância n8n
- Projeto Google Cloud com Sheets API e Gemini habilitados
- Planilha Google Sheets com as colunas: `session_id`, `CLIENTE`, `E-MAIL`, `DESTINO`, `DATA VIAGEM`, `QT PAX`, `TEL PAX`, `STATUS`, `DATA DE ENTRADA`

### Instalação

1. Importe os quatro arquivos `.json` no n8n.
2. Configure as credenciais:
   - **Redis** — URL e senha da instância
   - **Google Sheets OAuth2** — conta com acesso à planilha de controle
   - **Google Palm API** — chave para uso do Gemini
3. No workflow `Agaxtur V2 - Produção`, aponte o nó `Buffering` para o workflow `generic-buffer`.
4. Aponte o nó `Call 'Tool agaxtur'` para o workflow `Tool registra dados`.
5. Configure o webhook do Chatwoot para apontar para a URL do nó `Webhook` do workflow principal.
6. Ative os workflows na ordem: `generic-buffer` → `Tool registra dados` → `Agaxtur V2 - Produção` → `Follow Up Agaxtur`.

---

## 🏷️ Tags

`n8n` `whatsapp` `chatwoot` `meta` `ai-agent` `gemini` `redis` `google-sheets` `follow-up` `customer-service`
