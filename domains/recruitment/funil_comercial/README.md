# 📈 Funil Comercial — Qualificação e Agendamento Automatizado (n8n)

Sistema de funil comercial automatizado via **WhatsApp**, construído em n8n. A **Gabi**, atendente virtual da BMídia Digitais, conduz leads por um script de qualificação estruturado em 7 etapas, envia ativamente imagens de exemplo dos serviços da empresa e aplica uma **condicional de faturamento** que bifurca o atendimento em dois caminhos: leads com faturamento mensal acima de R$10.000 são direcionados para agendamento de reunião com o Head Comercial via **Google Calendar**; leads abaixo desse threshold recebem automaticamente a oferta de um infoproduto. Ao final, os dados do lead são extraídos em JSON por um agente de pós-processamento e notificados ao **grupo interno** da equipe via WhatsApp.

---

## 📁 Arquivo

| Arquivo | Descrição |
|---|---|
| [`funil_comercial_sanitized.json`](./funil_comercial_sanitized.json) | Workflow único — recebe mensagens, conduz o funil, qualifica o lead e encaminha para o destino correto |

> ⚠️ **Todos os dados sensíveis foram removidos.** Substitua os placeholders `{{...}}` pelos valores reais antes de importar no n8n. Veja a seção [Configuração](#%EF%B8%8F-configuração) abaixo.

---

## 🏗️ Arquitetura

```
WhatsApp (Evolution API Webhook — /comercialBMIDIA)
         │
         ▼
┌─────────────────────────────────────────┐
│   Entrada e Filtragem                   │
│                                         │
│  Webhook → variaveisWebhook             │
│         │                               │
│       #sair?                            │  ← Limpa Redis + confirma saída
│         │                               │
│   Get many rows (NocoDB)               │  ← Consulta base de leads por telefone
│         │                               │
│   verificaContato                       │  ← Valida se número pode ser atendido
│         │                               │
│  verificaTipoMensagem (switch)          │
│  ├── audio   → Analyze audio1 (Gemini) │  ← Transcrição de áudio
│  ├── image   → Analyze image  (Gemini) │  ← Análise de imagem
│  ├── video   → Analyze video  (Gemini) │
│  ├── file    → Analyze document        │
│  └── texto   → messageText             │
│         │                               │
│     unificaMessage                      │
└─────────┼───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│   Buffer (sub-workflow externo)         │  ← Agrupa mensagens via Redis (140s)
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│   AI Agent — Gabi (OpenAI + Redis)      │
│                                         │
│   Script de qualificação (7 etapas)    │
│         │                               │
│   escrevendo... (presence WhatsApp)    │  ← Simulação de digitação
│         │                               │
│   output == "imagem_Modelo"?            │  ← se for pra disparar a imagem
│       │                                 │
│  SIM  │                   NÃO          │
│  ├── Enviar texto2                      │  ← Msg de contexto sobre os anúncios
│  ├── Download file1 (Google Drive)     │  ← Baixa imagem de exemplo
│  ├── Extract from File1                │
│  ├── Wait → Evolution API1 (send-image)│  ← Envia imagem ao lead
│  └── Wait1 → Enviar texto              │  ← Pergunta sobre anúncios anteriores
│                           │            │
│                   Mensagem em texto    │  ← Envia resposta normal
│                           │            │
│                       Switch           │  ← Output contém link do Calendar?
│                           │            │
│                    enviaGrupo          │  ← Agente extrator de JSON do lead
│                           │            │
│                     relatorio          │  ← Formata var_assistant
│                           │            │
│                  Enviar para grupo     │  ← Notifica equipe interna
└─────────────────────────────────────────┘
```

---

## 📋 Detalhamento do Fluxo

### Etapa 1 — Entrada e Verificação do Lead

O webhook recebe todas as mensagens no path `/comercialBMIDIA`. O nó `variaveisWebhook` normaliza as variáveis essenciais (telefone, instanceId, tipo de mensagem) e o fluxo verifica imediatamente se o comando `#sair` foi enviado — nesse caso, a memória Redis do lead é apagada e a sessão encerrada com confirmação.

O nó `Get many rows` consulta o **NocoDB** buscando o telefone do lead na base de dados, permitindo identificar se o contato é novo ou já registrado. Na sequência, `verificaContato` valida se o número está apto a ser atendido antes de qualquer processamento.

### Etapa 2 — Suporte a Mídia

Toda mensagem passa pelo `verificaTipoMensagem` antes de chegar ao agente. Áudios são transcritos, e imagens, vídeos e documentos são analisados pelo **Google Gemini**, sendo unificados com mensagens de texto no nó `unificaMessage`. O agente recebe sempre uma mensagem limpa e interpretada, independente do formato original enviado pelo lead.

### Etapa 3 — Script de Qualificação (7 etapas obrigatórias)

A Gabi conduz o lead por um roteiro fixo. O agente é instruído a **nunca pular etapas** e a **não acionar a condicional antes da etapa 7**, mesmo que o valor de faturamento já tenha sido informado anteriormente:

| Etapa | Ação do agente |
|---|---|
| 1 | Saudação e apresentação da BMídia Digitais |
| 2 | Coleta do nome do lead |
| 3 | Identifica modalidade de operação (delivery, encomendas ou ambos) |
| 4 | Coleta Instagram e/ou TikTok do lead |
| 5 | Emite o token `imagem_Modelo` → dispara envio ativo da imagem de exemplo |
| 6 | Pergunta sobre faturamento mensal atual → **apenas armazena, não aciona condicional** |
| 7 | Pergunta sobre faturamento desejado nos próximos 3 meses → **aciona a condicional** |

### Etapa 4 — Envio Ativo de Imagem de Exemplo

Na etapa 5 do script, o agente emite exclusivamente o token `imagem_Modelo`. O nó `se for pra disparar a imagem` detecta esse output no campo `AI Agent.output` e aciona a seguinte sequência automática:

```
Enviar texto2  →  "Perfeito! Hoje nós utilizamos imagens e vídeos que as nossas
                   clientes já têm no Instagram para vender mais com tráfego..."
      │
Download file1 (Google Drive — imagem de exemplo dos serviços)
      │
Extract from File1 (binaryToProperty)
      │
Wait → Evolution API1 (send-image → cliente)
      │
Wait1 → Enviar texto → "Você já fez anúncios online antes pra aumentar seu
                         faturamento mensal?"
```

Esse mecanismo garante que a imagem seja enviada em um momento exato e controlado do funil, sem depender de nenhuma ação manual ou comando do lead.

### Etapa 5 — Condicional de Faturamento

Após a resposta da etapa 7, o agente interpreta o valor informado convertendo abreviações como `8k`, `12 mil` ou `R$9.500` para número inteiro antes de comparar com o threshold de **R$10.000**. A condicional é fixada pelo valor da **etapa 6** e não pode ser alterada por respostas posteriores do lead.

**Condicional 1 — Faturamento > R$10.000/mês → Lead qualificado**

O agente envia o link do **Google Calendar** para agendamento de uma reunião de 10 minutos com o Head Comercial e solicita confirmação do agendamento. O nó `Switch` monitora o output do agente e, ao detectar o link do Calendar na mensagem enviada, aciona o agente de pós-processamento para extração e notificação dos dados.

**Condicional 2 — Faturamento ≤ R$10.000/mês → Oferta do infoproduto**

O agente apresenta o infoproduto (pacote dos 10 vídeos mais vendáveis do mês) com a justificativa de que o lead ainda não está no momento ideal para investir em gestão de tráfego completa, e envia o link de compra diretamente no chat.

### Etapa 6 — Extração de Dados e Notificação Interna

Após o lead receber o link do Calendar, o agente `enviaGrupo` (agente de pós-processamento) extrai os dados da conversa em formato JSON com nome e informações coletadas. O nó `relatorio` formata o objeto `var_assistant` e o nó `Enviar para grupo` dispara a notificação para o grupo interno da equipe via WhatsApp com nome, telefone e horário do recebimento.

---

## 🤖 Persona do Agente

A **Gabi** opera como representante humana da BMídia Digitais — agência especializada em gestão de tráfego pago para o segmento de confeitaria. O prompt é construído com regras rígidas de comportamento:

- **Nunca revelar** que é um sistema automatizado
- **Nunca pular etapas** do script de qualificação
- **Nunca acionar condicional** antes da resposta da etapa 7, mesmo que o valor já tenha sido mencionado
- **Interpretar corretamente** abreviações de valor monetário (`k`, `mil`, `R$`) antes de aplicar a lógica de bifurcação
- **Fixar a condicional** com base na primeira resposta de faturamento — respostas posteriores não a alteram (exceto se o lead corrigir explicitamente)
- Responder com empatia a perguntas fora de contexto e retomar o fluxo naturalmente

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| Evolution API (WhatsApp) | Recebimento e envio de mensagens, imagens e status "digitando" | API Key via credencial n8n |
| Google Gemini | Transcrição de áudio, análise de imagem/vídeo/documento | API Key (googlePalmApi) |
| OpenAI | Modelo de linguagem dos dois agentes (AI Agent e enviaGrupo) | API Key via credencial n8n |
| Redis | Buffer de mensagens e memória conversacional do agente | Credencial Redis no n8n |
| NocoDB | Base de dados de leads — consulta por telefone | API Token via credencial n8n |
| Google Drive | Armazenamento e download da imagem de exemplo dos serviços | OAuth2 via credencial n8n |
| Google Calendar | Link de agendamento da reunião com o Head Comercial (enviado via chat) | — (link externo, sem integração direta) |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted ou cloud)
- Instância **Evolution API** conectada ao número WhatsApp comercial
- API Key da **OpenAI** (modelo dos agentes de qualificação e extração)
- API Key do **Google Gemini** (análise de mídia)
- Instância **Redis** acessível pelo n8n
- Projeto **NocoDB** com tabela de leads criada
- Imagem de exemplo dos serviços (`exemplo.jpg`) salva no Google Drive
- Sub-workflow de **buffer** (`buffering COMERCIAL`) importado e ativo
- Sub-workflow de **envio de texto** (`generic-text`) importado e ativo
- Grupo WhatsApp interno criado e JID identificado
- Link do Google Calendar configurado para a agenda do Head Comercial

### Instalação

1. **Importe o workflow** `funil_comercial_sanitized.json` no n8n.

2. **Configure as credenciais** no n8n:
   - `openAiApi` — API Key da OpenAI
   - `googlePalmApi` — API Key do Google Gemini
   - `googleDriveOAuth2Api` — OAuth2 Google Drive
   - `evolutionApi` — URL base e token da instância Evolution API
   - `redis` — host, porta e senha do Redis
   - `nocoDbApiToken` — URL e token da instância NocoDB

3. **Substitua todos os placeholders** `{{...}}` pelos valores reais conforme a tabela abaixo.

4. **Atualize os IDs dos sub-workflows** nos nós `Buffering` e `Mensagem em texto` com os IDs gerados após a importação dos workflows de suporte.

5. **Configure o webhook na Evolution API:** aponte o webhook de mensagens recebidas para a URL do nó Webhook (path: `/comercialBMIDIA`).

6. **Ative o workflow.**

### Placeholders

| Placeholder | Onde substituir | Descrição |
|---|---|---|
| `{{WEBHOOK_ID}}` | Nó `Webhook` e nós `Wait` | ID interno do webhook n8n |
| `{{CREDENTIAL_GOOGLE_GEMINI_ID}}` | Nós `Analyze image/audio/video/document` | ID da credencial Google Gemini |
| `{{CREDENTIAL_GOOGLE_DRIVE_ID}}` | Nó `Download file1` | ID da credencial Google Drive OAuth2 |
| `{{CREDENTIAL_EVOLUTION_API_ID}}` | Todos os nós Evolution API | ID da credencial Evolution API |
| `{{CREDENTIAL_REDIS_ID}}` | Nós `Delete`, `Redis Chat Memory`, `Get Last Content` | ID da credencial Redis |
| `{{CREDENTIAL_NOCODB_ID}}` | Nó `Get many rows` | ID da credencial NocoDB |
| `{{CREDENTIAL_OPENAI_ID}}` | Nós `OpenAI Chat Model` e `OpenAI Chat Model1` | ID da credencial OpenAI |
| `{{ALLOWED_PHONE_1}}` | Nós `verificaContato` e `Get Last Content` | Número autorizado para testes internos |
| `{{WHATSAPP_GROUP_JID}}` | Nó `Enviar para grupo` | JID do grupo WhatsApp de notificação interna |
| `{{NOCODB_PROJECT_ID}}` | Nó `Get many rows` | ID do projeto no NocoDB |
| `{{NOCODB_TABLE_LEADS_ID}}` | Nó `Get many rows` | ID da tabela de leads no NocoDB |
| `{{GOOGLE_DRIVE_FILE_EXEMPLO_ID}}` | Nó `Download file1` | ID da imagem de exemplo no Google Drive |
| `{{CALENDAR_AGENDAMENTO_URL}}` | System prompt dos agentes e nó `Switch` | Link do Google Calendar do Head Comercial |
| `{{HOTMART_PRODUTO_URL}}` | System prompt dos agentes | Link de compra do infoproduto |
| `{{WORKFLOW_BUFFER_ID}}` | Nó `Buffering` | ID do sub-workflow de buffer |
| `{{WORKFLOW_GENERIC_TEXT_ID}}` | Nó `Mensagem em texto` | ID do sub-workflow de envio de texto |

### Comando especial

Enviar `#sair` pelo WhatsApp apaga a memória Redis da conversa e encerra a sessão — útil para reiniciar o atendimento durante testes sem precisar trocar de número.

---

## 🔒 Segurança

- Nunca versione o arquivo JSON com credenciais ou URLs reais preenchidas
- O `{{ALLOWED_PHONE_1}}` aparece em **dois lugares** no workflow: no nó `verificaContato` (whitelist) e no nó `Get Last Content` como chave Redis hardcoded — substitua em ambos
- O `{{CALENDAR_AGENDAMENTO_URL}}` e o `{{HOTMART_PRODUTO_URL}}` estão embutidos no **system prompt dos agentes** — qualquer alteração nesses prompts deve ser testada para garantir que a lógica de condicional não seja quebrada
- O **JID do grupo interno** recebe dados completos de leads (nome + telefone) — mantenha o acesso ao grupo restrito à equipe comercial
- A tabela de leads no NocoDB contém dados pessoais — restrinja o token de API ao escopo de leitura necessário
- O prompt dos agentes possui regras de controle de estado do funil embutidas (`REGRA ABSOLUTA — BLOQUEIO DE CONDICIONAIS POR ETAPA`) — não as remova sem testes extensivos, pois são responsáveis por impedir que a condicional seja acionada prematuramente
