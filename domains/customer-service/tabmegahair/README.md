# 💇 TAB Megahair — Bot Comercial IA (n8n)

Sistema de atendimento comercial automatizado via **WhatsApp**, construído em n8n. O bot opera como a atendente virtual **Paty**, recebe clientes interessadas em megahair, conduz o fluxo de atendimento com base em um FAQ detalhado, envia fotos de referência do catálogo por comprimento desejado, realiza **notificações automáticas para grupos internos** ao final do atendimento e conta com **buffer de mensagens** via Redis para agrupamento natural de envios.

---

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| [`BOT_Comercial_tabmegahair_sanitized.json`](./BOT_Comercial_tabmegahair_sanitized.json) | Workflow principal — recebe mensagens, orquestra o agente Paty e dispara notificações |
| [`tamanhos_sanitized.json`](./tamanhos_sanitized.json) | Sub-workflow de catálogo — envia foto de referência conforme o comprimento escolhido pela cliente |
| [`buffering_NATHAN_sanitized.json`](./buffering_NATHAN_sanitized.json) | Buffer de mensagens — agrupa envios múltiplos antes de processar |

> ⚠️ **Todos os dados sensíveis foram removidos.** Substitua os placeholders `{{...}}` pelos valores reais antes de importar no n8n. Veja a seção [Configuração](#%EF%B8%8F-configuração) abaixo.

---

## 🏗️ Arquitetura

```
WhatsApp (Evolution API Webhook)
         │
         ▼
┌─────────────────────────────────────────┐
│   BOT Comercial (Workflow Principal)    │
│                                         │
│  Webhook → variaveisWebhook             │
│         │                               │
│       #sair?                            │  ← Limpa Redis + confirma saída
│         │                               │
│   verificaContato (whitelist)           │  ← Filtra números autorizados
│         │                               │
│  verificaTipoMensagem (switch)          │
│  audio / texto / image / video / file   │
│         │                               │
│  Gemini (transcrição ou análise mídia) │
│         │                               │
│     unificaMessage                      │
│         │                               │
└─────────┼───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│   Buffer (buffering NATHAN)             │  ← Agrupa msgs via Redis
│                                         │
│  Redis push → Wait 8s                  │
│  → Verifica se chegou nova msg          │
│       ├── Sim: descarta (ciclo novo)   │
│       └── Não: agrega lista → retorna  │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│   Agente Paty (Triagem)                 │  ← Gemini + Redis Memory
│                                         │
│  Fluxo conversacional natural           │
│  baseado em FAQ + scripts de atendimento│
│         │                               │
│    output == "imagem_Modelo"?           │
│       ├── Sim: dispara catálogo         │
│       └── Não: envia texto direto       │
│                                         │
│  Tool: tamanhos                         │  ← Sub-workflow de catálogo
│                                         │
│  output contém link de avaliação?       │
│       ├── Sim → enviaGrupo             │  ← Extrai nome + tamanho → grupo
│       └── Não → enviaGrupo1            │  ← Extrai nome + demanda → grupo
└─────────────────────────────────────────┘
          │
    ┌─────┴──────────────────────────┐
    ▼                                ▼
Notificação grupo WhatsApp      Envio de texto
(nome + tel + tamanho/demanda)  (Evolution API → cliente)
```

---

## 📋 Workflows

### 1. `BOT Comercial tabmegahair`

Workflow principal. Recebe todas as mensagens via webhook, processa a mídia recebida, orquestra o agente e dispara as notificações internas ao final do atendimento.

**Fluxo:**

```
Webhook (POST /TAB)
  → variaveisWebhook
      (Telefone, instanceId, userMessage, userName, type, geminiPrompt1/2)
  → #sair?
      → Sim: Delete Redis → Enviar confirmação de histórico apagado
      → Não: verificaContato
            → Fora da lista: encerra silenciosamente
            → Na lista: verificaTipoMensagem (switch)
                  ├── audio    → Analyze audio (Gemini) → audioTranscrito
                  ├── texto    → messageText
                  ├── image    → Analyze image (Gemini) → messageGemini
                  ├── video    → Analyze video (Gemini) → messageGemini
                  └── file     → Analyze document (Gemini) → messageGemini
  → unificaMessage
  → Buffering (sub-workflow)
  → Triagem (Agente Paty — Gemini + Redis Memory)
      → escrevendo... (presence "digitando" no WhatsApp)
      → Mensagem em texto (envia resposta à cliente)
      → Switch (verifica tipo de fechamento)
            ├── Link de avaliação enviado → enviaGrupo
            │     → relatorio (extrai nome + tamanho do JSON)
            │     → Enviar para grupo (notificação interna)
            └── Outro fechamento → enviaGrupo1
                  → relatorio1 (extrai nome + demanda do JSON)
                  → Enviar para grupo1 (notificação interna)
```

**Diferenciais:**
- **Persona humanizada:** a atendente Paty nunca se identifica como bot — o tom é caloroso, simpático e profissional
- **Fluxo conversacional com gatilho visual:** quando a cliente responde se já usou megahair, o agente emite o token `imagem_Modelo`, que aciona automaticamente o envio do catálogo de fotos por comprimento
- **Notificação dupla para grupos internos:** ao detectar que a avaliação foi agendada (link do Calendly na conversa), um agente de pós-processamento extrai nome + tamanho do histórico e dispara a notificação para o grupo da equipe — e o mesmo para leads de manutenção ou curso com o campo `demanda`
- **Suporte a mídia:** áudio é transcrito, imagens/vídeos/documentos são analisados pelo Gemini antes de chegar ao agente

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n |
| `{{CREDENTIAL_GOOGLE_GEMINI_ID}}` | ID da credencial Google Gemini |
| `{{CREDENTIAL_REDIS_ID}}` | ID da credencial Redis |
| `{{CREDENTIAL_EVOLUTION_API_ID}}` | ID da credencial Evolution API |
| `{{CREDENTIAL_GOOGLE_DRIVE_ID}}` | ID da credencial Google Drive |
| `{{ALLOWED_PHONE_1}}` / `{{ALLOWED_PHONE_2}}` | Telefones autorizados a usar o bot |
| `{{GOOGLE_DRIVE_FILE_CABELOMODELO_JPG_ID}}` | ID da imagem modelo no Google Drive |
| `{{WHATSAPP_GROUP_JID}}` | JID do grupo WhatsApp de notificação interna |
| `{{WORKFLOW_BUFFERING_NATHAN_ID}}` | ID do workflow de buffer |
| `{{WORKFLOW_TAMANHOS_ID}}` | ID do workflow de catálogo de tamanhos |
| `{{WORKFLOW_GENERIC_TEXT_ID}}` | ID do sub-workflow de envio de texto |

---

### 2. `tamanhos`

Sub-workflow acionado como **tool** pelo agente principal sempre que a cliente demonstra interesse em ver exemplos reais de megahair por comprimento. Para cada tamanho (30cm a 70cm), baixa a imagem correspondente do Google Drive, converte para base64 e envia diretamente no chat da cliente via Evolution API.

**Fluxo:**

```
Recebe (phoneNumber + tamanho + InstanceId)
  → Formalizar (normaliza variáveis)
  → Switch "tipos de tamanho"
      ├── "30" → Enviar texto + Download file (30cm) → Extract → send-image
      ├── "35" → Enviar texto + Download file (35cm) → Extract → send-image
      ├── "40" → Enviar texto + Download file (40cm) → Extract → send-image
      ├── "45" → Enviar texto + Download file (45cm) → Extract → send-image
      ├── "50" → Enviar texto + Download file (50cm) → Extract → send-image
      ├── "55" → Enviar texto + Download file (55cm) → Extract → send-image
      ├── "60" → Enviar texto + Download file (60cm) → Extract → send-image
      ├── "65" → Enviar texto + Download file (65cm) → Extract → send-image
      └── "70" → Enviar texto + Download file (70cm) → Extract → send-image
  → Resposta para o Agente
      ("A imagem com tamanho específico já foi enviada! Siga normalmente com o fluxo.")
```

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_EVOLUTION_API_ID}}` | ID da credencial Evolution API |
| `{{CREDENTIAL_GOOGLE_DRIVE_ID}}` | ID da credencial Google Drive |
| `{{GOOGLE_DRIVE_FILE_30_JPG_ID}}` … `{{GOOGLE_DRIVE_FILE_70_JPG_ID}}` | IDs das imagens de referência por tamanho no Google Drive |

---

### 3. `buffering NATHAN`

Sub-workflow de buffer de mensagens. Responsável por agrupar múltiplos envios seguidos da mesma cliente antes de passar o conteúdo ao agente, evitando processamentos fragmentados.

**Fluxo:**

```
Recebe (message + phoneNumber + delayTimeMs)
  → Presets (monta chave Redis: services:message-buffering:{phoneNumber})
  → Push Content (salva mensagem na lista Redis)
  → Wait 8 segundos
  → Get Last Content (busca última mensagem da lista)
  → Verificar se há nova mensagem
      → Diferente (nova msg chegou): encerra (deixa o próximo ciclo processar)
      → Igual (nenhuma nova msg): Capturar lista de mensagens
            → Agrega todas em string única (ordem cronológica)
            → Delete Buffered Messages
            → Retorna ao workflow principal
```

**Placeholders:**

| Placeholder | Descrição |
|---|---|
| `{{CREDENTIAL_REDIS_ID}}` | ID da credencial Redis |
| `{{WEBHOOK_ID}}` | ID interno do webhook n8n (nó Wait) |

---

## 🤖 Persona da Atendente

A **Paty** é a identidade do bot — não uma IA, mas uma atendente humana do estúdio TAB Megahair. O prompt é construído para:

- Nunca revelar que é um sistema automatizado
- Seguir um FAQ oficial com respostas validadas pelo estúdio
- Conduzir a cliente pelo fluxo: **saudação → nome → experiência prévia → catálogo visual → tamanho → agendamento de avaliação gratuita**
- Tratar fluxos específicos de **manutenção** e **cursos** com scripts dedicados
- Emitir o token interno `imagem_Modelo` como gatilho para o envio automático do catálogo
- Enviar o link do Calendly apenas **uma vez** por conversa

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| Evolution API (WhatsApp) | Recebimento e envio de mensagens, imagens e status "digitando" | API Key via credencial n8n |
| Google Gemini | Agente conversacional (Paty), transcrição de áudio, análise de mídia, pós-processamento de relatório | API Key (googlePalmApi) |
| Google Drive | Armazenamento e download das imagens de catálogo por comprimento | OAuth2 via credencial n8n |
| Redis | Buffer de mensagens e memória conversacional do agente | Credencial Redis no n8n |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted ou cloud)
- Instância **Evolution API** conectada ao número WhatsApp do estúdio
- API Key do Google Gemini (Google AI Studio)
- Credencial OAuth2 Google Drive configurada no n8n
- Instância Redis acessível pelo n8n
- Pasta no Google Drive com as **9 imagens de referência** nomeadas por comprimento (30cm a 70cm)
- Imagem modelo de exemplo (`cabelomodelo.jpg`) no Google Drive
- Grupo WhatsApp interno criado e JID identificado

### Instalação

1. **Importe os workflows** no n8n nesta ordem:
   1. `buffering_NATHAN_sanitized.json`
   2. `tamanhos_sanitized.json`
   3. `BOT_Comercial_tabmegahair_sanitized.json`

2. **Configure as credenciais** no n8n:
   - `googlePalmApi` — API Key do Google Gemini
   - `googleDriveOAuth2Api` — OAuth2 Google Drive
   - `redis` — host, porta e senha do Redis
   - `evolutionApi` — URL base e token da instância Evolution API

3. **Substitua todos os placeholders** `{{...}}` pelos valores reais em cada workflow conforme as tabelas acima.

4. **Configure a whitelist** no nó `verificaContato` com os telefones autorizados no formato `5511999999999`.

5. **Adicione os IDs das imagens do Drive** no workflow `tamanhos` — um arquivo por tamanho (30, 35, 40, 45, 50, 55, 60, 65, 70 cm).

6. **Atualize o JID do grupo** no nó `Enviar para grupo` e `Enviar para grupo1` com o JID real do grupo interno (formato `120363xxxxxxxxx@g.us`).

7. **Vincule os sub-workflows** no BOT Comercial: atualize os `workflowId` dos nós `Buffering`, `Call 'tamanhos'` e `Mensagem em texto` com os IDs gerados na importação.

8. **Configure o webhook na Evolution API:** aponte o webhook de mensagens recebidas para a URL do nó Webhook do BOT Comercial (path: `/TAB`).

9. **Ative os 3 workflows.**

### Comando especial

Enviar `#sair` pelo WhatsApp limpa a memória Redis da conversa — útil para reiniciar o atendimento durante testes.

---

## 🔒 Segurança

- Nunca versione os arquivos JSON com credenciais reais
- A **whitelist de telefones** no nó `verificaContato` é a primeira barreira de acesso — mantenha-a restrita aos responsáveis pelo estúdio
- As **imagens do catálogo** no Google Drive devem ter permissão de leitura restrita ao Service Account / OAuth2 utilizado
- O **JID do grupo interno** não deve ser exposto publicamente — notificações de leads chegam diretamente à equipe
- A URL base da Evolution API identifica sua instância — mantenha-a privada
- O prompt da Paty contém proteção anti-quebra de fluxo embutida (`REGRA ABSOLUTA`, `REGRAS DE RESTRIÇÃO CONVERSACIONAL`) — não os remova ou altere sem testes
