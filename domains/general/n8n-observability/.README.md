# 🚨 Notificador de Erros (n8n)

Sistema de monitoramento de falhas para workflows n8n. Quando qualquer workflow com este notificador configurado como **Error Workflow** falha, uma mensagem é enviada automaticamente via **WhatsApp** (UazAPI) com o nome do projeto, o nó onde ocorreu o erro, a descrição da falha e o link direto para a execução.

---

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| [`Notificador_de_Erros_sem_credenciais.json`](./Notificador_de_Erros_sem_credenciais.json) | Workflow único — captura erros e envia notificação via WhatsApp |

> ⚠️ **Dados sensíveis foram removidos.** Substitua os placeholders antes de importar no n8n. Veja a seção [Configuração](#%EF%B8%8F-configuração) abaixo.

---

## 🏗️ Arquitetura

```
Qualquer Workflow com erro
         │
         ▼ (Error Workflow configurado)
┌─────────────────────────────────┐
│   Error Trigger                 │  ← Disparado automaticamente pelo n8n
│         │                       │
│         ▼                       │
│     variaveis (Set)             │  ← Extrai dados do erro
│   - nodeError                   │     (nó, workflow, mensagem, URL)
│   - workflowName                │
│   - errorMessage                │
│   - executionUrl                │
│         │                       │
│         ▼                       │
│   Send text message (UazAPI)    │  ← Envia notificação via WhatsApp
└─────────────────────────────────┘
```

---

## 📋 Workflow

### `Notificador de Erros`

Workflow de uso global. Deve ser configurado como **Error Workflow** em cada projeto que você queira monitorar.

**Fluxo:**

```
Error Trigger
  → variaveis (Set)
      Extrai de $json:
        - execution.lastNodeExecuted  → nodeError
        - workflow.name               → workflowName
        - execution.error.message     → errorMessage
        - execution.url               → executionUrl
  → Send text message (UazAPI)
      Envia para grupo/contato configurado:
        "O projeto de nome "[workflowName]" está com problemas.
         Execução do erro: [executionUrl]
         Nó/node onde ocorreu o erro: [nodeError]
         Descrição do erro: [errorMessage]"
```

**Mensagem enviada (exemplo real):**

```
O projeto de nome "CFO Digital - Agente Conversacional" está com problemas.
Execução do erro: https://sua-instancia.n8n.io/execution/1234
Nó/node onde ocorreu o erro: Send text message
Descrição do erro: Cannot read properties of undefined (reading 'phoneNumber')
```

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| UazAPI (WhatsApp) | Envio da notificação de erro | API Key via credencial n8n |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted ou cloud)
- Instância UazAPI configurada e conectada a um número WhatsApp
- Grupo ou contato WhatsApp para receber as notificações (obter o ID no formato `120363...@g.us` para grupos ou `5511...@s.whatsapp.net` para contatos)

### Instalação

1. **Importe o workflow** `Notificador_de_Erros.json` no n8n.

2. **Configure a credencial UazAPI** no n8n:
   - Vá em **Credentials → New → UazAPI**
   - Preencha a URL base da sua instância e o token de autenticação

3. **Abra o nó `Send text message`** e substitua o número de destino pelo ID do seu grupo ou contato WhatsApp.

4. **Ative o workflow.**

5. **Conecte aos seus outros workflows:**
   - Abra qualquer workflow que deseja monitorar
   - Vá em **Settings** (ícone de engrenagem)
   - Em **Error Workflow**, selecione `Notificador de Erros`
   - Salve

### Conectando a outros workflows

Este é o passo mais importante. O Notificador de Erros só é disparado se estiver configurado como Error Workflow nos projetos que você quer monitorar.

**Passo a passo:**

```
1. Abra o workflow que deseja monitorar no n8n
2. Clique no ícone de engrenagem (⚙️) no canto superior direito
3. Em "Error Workflow", clique no campo e selecione "Notificador de Erros"
4. Clique em "Save"
```

Repita para **cada workflow** que deve ser monitorado. Não há limite de workflows conectados ao mesmo Notificador de Erros.

> 💡 **Dica:** Em instâncias com muitos workflows, configure o Notificador em todos os workflows de produção antes de ativá-los. Workflows de desenvolvimento/teste geralmente não precisam de notificação.

---

## 🔧 Personalização

### Alterar o destino das notificações

No nó `Send text message`, o campo `number` define quem recebe o alerta:

| Formato | Tipo | Exemplo |
|---|---|---|
| `5511999999999@s.whatsapp.net` | Contato individual | Você mesmo ou colega |
| `120363xxxxxxxxx@g.us` | Grupo WhatsApp | Grupo de DevOps/TI |

Para encontrar o ID de um grupo UazAPI, acesse o endpoint de listagem de grupos da sua instância.

### Alterar o texto da notificação

Edite o campo `text` no nó `Send text message`. As variáveis disponíveis são:

| Variável | Conteúdo |
|---|---|
| `{{ $json.workflowName }}` | Nome do workflow que falhou |
| `{{ $json.executionUrl }}` | Link direto para a execução com erro no n8n |
| `{{ $json.nodeError }}` | Nome do último nó executado antes da falha |
| `{{ $json.errorMessage }}` | Mensagem de erro retornada pelo n8n |

### Adicionar mais canais de notificação

O workflow pode ser expandido facilmente. Após o nó `variaveis`, conecte quantos nós de notificação precisar em paralelo:

```
variaveis (Set)
    ├── Send text message (WhatsApp)
    ├── Send Email (Gmail/SMTP)
    ├── Post message (Slack/Telegram)
    └── Create issue (Jira/Linear)
```

---

## 🔒 Segurança

- Nunca versione o JSON com a credencial UazAPI preenchida
- Restrinja o acesso ao grupo/contato de notificações — as mensagens contêm URLs internas da sua instância n8n
- Se a instância n8n for pública, as `executionUrl` expostas nas mensagens podem dar acesso a logs de execução — avalie se o grupo de destino é adequado
- Mantenha o workflow **sempre ativo** — um Notificador de Erros inativo não dispara nenhum alerta

---

## 🏷️ Tags

`n8n` `monitoring` `error-handling` `whatsapp` `uazapi` `devops`
