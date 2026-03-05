# 🤖 Atendimento — Agente Conversacional IA (n8n)

Sistema de atendimento automatizado via **WhatsApp** com agente de IA consultivo, construído em n8n. O agente recebe mensagens de texto, áudio, imagem, vídeo e documentos, processa cada tipo com **Google Gemini**, mantém memória de conversa via **Redis** e conduz o lead até o agendamento de uma reunião com a equipe de vendas.

---

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| [`Atendimento_-_Agente_Conversacional_sanitized.json`](./Atendimento_-_Agente_Conversacional_sanitized.json) | Workflow principal — recebe mensagens e orquestra o agente de IA |
| [`Atendimento_-_Buffer_sanitized.json`](./Atendimento_-_Buffer_sanitized.json) | Buffer de mensagens via Redis para agrupar envios rápidos |
| [`Atendimento_-_Envio_de_texto_sanitized.json`](./Atendimento_-_Envio_de_texto_sanitized.json) | Sub-workflow de envio de mensagens de texto via WhatsApp |
| [`Atendimento_-_Envio_de_audio_sanitized.json`](./Atendimento_-_Envio_de_audio_sanitized.json) | Sub-workflow de envio de mensagens de áudio via WhatsApp |
| [`Atendimento_-_Aviso_em_grupo_de_lead_sanitized.json`](./Atendimento_-_Aviso_em_grupo_de_lead_sanitized.json) | Sub-workflow de notificação interna ao grupo da equipe |

> ⚠️ **Todos os dados sensíveis foram removidos.** Substitua os placeholders `{{...}}` pelos valores reais antes de importar no n8n. Veja a seção [Configuração](#%EF%B8%8F-configuração) abaixo.

---

## 🏗️ Arquitetura

```
WhatsApp (UazAPI Webhook)
         │
         ▼
┌─────────────────────────────────────┐
│   Agente Conversacional             │  ← Workflow principal
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │  Tipo mídia │  │  Redis       │  │
│  │  (switch)   │  │  Memory      │  │
│  └──────┬──────┘  └──────────────┘  │
│         │                           │
│   audio / texto / imagem            │
│   vídeo / documento                 │
│         │                           │
│         ▼                           │
│  ┌─────────────┐                    │
│  │  Gemini AI  │  (transcrição /    │
│  │  (análise)  │   análise)         │
│  └──────┬──────┘                    │
│         ▼                           │
│  ┌─────────────┐                    │
│  │  Buffer     │  ← agrupa msgs     │
│  └──────┬──────┘    simultâneas     │
│         ▼                           │
│  ┌─────────────┐                    │
│  │  AI Agent   │  ← Darko (closer)  │
│  │  (Gemini)   │                    │
│  └──────┬──────┘                    │
└─────────┼───────────────────────────┘
          │
    ┌─────┴──────────────────┐
    ▼                        ▼
Envio de texto/áudio    Aviso em grupo
(UazAPI → WhatsApp)     (equipe interna)
```

---

## 📋 Workflows

### 1. `Atendimento - Agente Conversacional`

Workflow principal. Recebe todas as mensagens do WhatsApp via webhook e orquestra o fluxo completo.

**Fluxo:**

```
Webhook (POST)
  → Extrai variáveis (phoneNumber, messageType, messageId, userMessage)
  → Verifica comando #sair
      → Sim: limpa Redis + envia confirmação ao usuário
      → Não: identifica tipo da mensagem (switch)
            ├── AudioMessage    → Download → Gemini (transcrição)
            ├── Conversation    → mensagem de texto direta
            ├── ImageMessage    → Download → Gemini (análise de imagem)
            ├── VideoMessage    → Download → Gemini (análise de vídeo)
            └── DocumentMessage → Download → Gemini (análise de documento)
  → Unifica mensagem em campo único
  → Envia ao Buffer (aguarda possíveis msgs simultâneas)
  → AI Agent "Darko" (Gemini 2.5 Flash + Redis Memory)
      └── Tool: cadastro → Aviso em grupo de lead
  → Envio de texto ao usuário
```

**Agente Darko:** closer consultivo da Darkay, conduz o lead através de um diagnóstico inicial coletando nome, empresa, dor, interesse em automação e disponibilidade para reunião. Ao completar a coleta, aciona a tool `cadastro` que notifica a equipe interna.

**Capacidades de mídia (via Gemini 2.0 Flash):**

| Tipo | Processamento |
|---|---|
| Áudio | Transcrição fiel no idioma original |
| Imagem | Descrição breve do conteúdo |
| Vídeo | Resumo do contexto |
| Documento | Leitura e resumo detalhado |

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{WEBHOOK_PATH}}` | Path do webhook (ex: `AtendimentoDarkay`) |
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n |
| `{{CREDENTIAL_ID}}` | ID da credencial Google Gemini (googlePalmApi) |
| `{{ATENDIMENTO_BUFFER_WORKFLOW_ID}}` | ID do workflow Atendimento - Buffer |
| `{{ATENDIMENTO_ENVIO_DE_TEXTO_WORKFLOW_ID}}` | ID do workflow Atendimento - Envio de texto |
| `{{ATENDIMENTO_AVISO_EM_GRUPO_DE_LEAD_WORKFLOW_ID}}` | ID do workflow Atendimento - Aviso em grupo de lead |
| `{{ERROR_WORKFLOW_ID}}` | ID do workflow de tratamento de erros |
| `{{INSTANCE_ID}}` / `{{VERSION_ID}}` / `{{WORKFLOW_ID}}` | IDs internos do n8n |

---

### 2. `Atendimento - Buffer`

Sub-workflow de buffer de mensagens. Evita que mensagens enviadas em sequência rápida pelo usuário sejam processadas separadamente pelo agente.

**Fluxo:**

```
Recebe (message + phoneNumber)
  → Salva mensagem em lista Redis (key por telefone)
  → Aguarda 12 segundos
  → Busca última mensagem da lista
  → Compara com a mensagem que iniciou este ciclo
      → São iguais (sem nova msg): agrega lista → deleta lista Redis → retorna
      → São diferentes (chegou nova msg): encerra sem processar
```

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_ID}}` | ID da credencial Redis |
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n (nó Wait) |
| `{{BUFFER_SERVICE_NAME}}` | Nome do serviço usado na Redis key (ex: `atendimentodarkay`) |
| `{{INSTANCE_ID}}` / `{{VERSION_ID}}` / `{{WORKFLOW_ID}}` | IDs internos do n8n |

---

### 3. `Atendimento - Envio de texto`

Sub-workflow responsável pelo envio das respostas do agente ao usuário via WhatsApp, dividindo mensagens longas em blocos separados por linha dupla.

**Fluxo:**

```
Recebe (phoneNumber + message)
  → Divide message por \n\n em array de blocos
  → Loop em cada bloco:
      → Envia bloco via UazAPI
      → Aguarda 1.5 segundos
      → Próximo bloco
```

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_ID}}` | ID da credencial UazAPI |
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n (nó Wait) |
| `{{INSTANCE_ID}}` / `{{VERSION_ID}}` / `{{WORKFLOW_ID}}` | IDs internos do n8n |

---

### 4. `Atendimento - Envio de áudio`

Sub-workflow de envio de mensagens via WhatsApp com a mesma lógica de blocos do Envio de texto, mas utilizando uma credencial UazAPI distinta.

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_ID}}` | ID da credencial UazAPI (conta alternativa) |
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n (nó Wait) |
| `{{INSTANCE_ID}}` / `{{VERSION_ID}}` / `{{WORKFLOW_ID}}` | IDs internos do n8n |

---

### 5. `Atendimento - Aviso em grupo de lead`

Sub-workflow acionado pelo agente ao concluir a qualificação de um lead. Envia uma mensagem formatada com todos os dados coletados para o grupo interno da equipe no WhatsApp.

**Dados enviados ao grupo:**

`phone` · `nome` · `empresa` · `dor` · `interesseAutomatizar` · `Disponibilidade` · `Resumo`

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_ID}}` | ID da credencial UazAPI |
| `{{WHATSAPP_GROUP_ID}}` | ID do grupo interno no WhatsApp (ex: `120363...@g.us`) |
| `{{INSTANCE_ID}}` / `{{VERSION_ID}}` / `{{WORKFLOW_ID}}` | IDs internos do n8n |

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| UazAPI (WhatsApp) | Recebimento e envio de mensagens | API Key via credencial n8n |
| Google Gemini 2.0 Flash | Transcrição de áudio e análise de mídia | API Key (googlePalmApi) |
| Google Gemini 2.5 Flash | Modelo do agente conversacional | API Key (googlePalmApi) |
| Redis | Buffer de mensagens e memória do agente | Credencial Redis no n8n |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted ou cloud)
- Instância UazAPI configurada e conectada a um número WhatsApp
- API Key do Google Gemini (Google AI Studio)
- Instância Redis acessível pelo n8n
- Grupo de WhatsApp criado para notificações internas da equipe

### Instalação

1. **Importe os workflows** no n8n nesta ordem:
   1. `Atendimento_-_Buffer_sanitized.json`
   2. `Atendimento_-_Envio_de_texto_sanitized.json`
   3. `Atendimento_-_Envio_de_audio_sanitized.json`
   4. `Atendimento_-_Aviso_em_grupo_de_lead_sanitized.json`
   5. `Atendimento_-_Agente_Conversacional_sanitized.json`

2. **Configure as credenciais** no n8n:
   - `googlePalmApi` — API Key do Google Gemini
   - `redis` — host, porta e senha do Redis
   - `uazApiApi` — URL base e token da instância UazAPI

3. **Substitua todos os placeholders** `{{...}}` pelos valores reais em cada workflow conforme as tabelas acima.

4. **Vincule os sub-workflows** no Agente Conversacional: atualize os `workflowId` dos nós `Execute Workflow` e `toolWorkflow` com os IDs gerados na importação.

5. **Configure o webhook na UazAPI:** aponte o webhook de mensagens recebidas para a URL do nó Webhook do Agente Conversacional.

6. **Obtenha o Group ID** do grupo de WhatsApp da equipe (formato `XXXXXXXXX@g.us`) e preencha no workflow Aviso em grupo de lead.

7. **Ative os 5 workflows.**

### Comando especial

Enviar `#sair` pelo WhatsApp limpa a memória Redis do usuário e encerra o atendimento — útil durante testes.

---

## 🔒 Segurança

- Nunca versione os arquivos JSON com credenciais reais
- O Group ID do WhatsApp interno é dado sensível — com ele e acesso à UazAPI qualquer pessoa pode enviar mensagens ao grupo da equipe
- O prompt do agente possui proteção contra prompt injection embutida — não remova os blocos `<Compliance>` e `<Legislação>`
- Considere restringir o webhook do n8n para aceitar requisições apenas do IP da instância UazAPI
