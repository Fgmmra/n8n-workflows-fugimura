# 🗑️ Lixeira de Execuções (n8n)

Workflow de manutenção automática para instâncias n8n. Apaga **todas as execuções finalizadas** (sucesso, erro e waiting) de workflows inativos, rodando semanalmente de madrugada para manter o banco de dados leve e a instância performática.

---

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| [`Lixeira_de_Execucoes_sanitized.json`](./Lixeira_de_Execucoes_sanitized.json) | Workflow único — coleta e deleta execuções antigas via API interna do n8n |

> ⚠️ **Dados sensíveis foram removidos.** Configure a credencial n8n API antes de ativar. Veja a seção [Configuração](#%EF%B8%8F-configuração) abaixo.

---

## 🏗️ Arquitetura

```
Schedule Trigger (semanal, 02h00)
  ┌────────────────┬─────────────────┐
  ▼                ▼                 ▼
Get executions  Get executions  Get executions
  (success)        (error)         (waiting)
  └────────────────┴─────────────────┘
                   │
                   ▼ (todos convergem)
          Delete an execution
          (loop por ID)
```

> O trigger manual ("Execute workflow") também está disponível para rodar a limpeza sob demanda a qualquer momento.

---

## 📋 Workflow

### `Lixeira de Execuções`

**Fluxo automático (semanal):**

```
Schedule Trigger → dispara toda semana às 02h00
  → Em paralelo, busca TODAS as execuções de workflows inativos com status:
      ├── success  (Get many executions Success)
      ├── error    (Get many executions Error)
      └── waiting  (Get many executions Waiting)
  → Todos os resultados convergem para:
      Delete an execution
        → itera sobre cada execução pelo $json.id e deleta via API
```

**Fluxo manual:**

```
When clicking 'Execute workflow'
  → mesmo fluxo acima, sob demanda
```

**O que é deletado:**

| Status | Descrição |
|---|---|
| `success` | Execuções concluídas com êxito |
| `error` | Execuções que falharam |
| `waiting` | Execuções pausadas (ex: nó Wait sem retomada) |

> ℹ️ O filtro `activeWorkflows: false` garante que apenas execuções de **workflows inativos** sejam deletadas, preservando execuções de workflows ainda em produção.

---

## 🔌 Integrações

| Serviço | Uso | Autenticação |
|---|---|---|
| n8n API (self-hosted) | Listagem e deleção de execuções | API Key via credencial `n8nApi` |

---

## ⚙️ Configuração

### Pré-requisitos

- Instância n8n ativa (self-hosted)
- API Key do n8n gerada (Settings → API → Create an API Key)

### Instalação

1. **Importe o workflow** `Lixeira_de_Execucoes_sanitized.json` no n8n.

2. **Crie a credencial n8n API:**
   - Vá em **Credentials → New → n8n API**
   - Preencha a URL base da sua instância (ex: `https://sua-instancia.n8n.io`)
   - Cole a API Key gerada em Settings

3. **Abra os três nós `Get many executions`** e atribua a credencial criada em cada um.

4. **Abra o nó `Delete an execution`** e atribua a mesma credencial.

5. **Ative o workflow.**

### Ajustando a frequência

O Schedule Trigger está configurado para rodar **1x por semana às 02h00**. Para alterar:

- Abra o nó `Schedule Trigger`
- Troque `weeks` por `days`, `hours` ou `months` conforme sua necessidade
- Ajuste `triggerAtHour` para o horário desejado (formato 24h)

### Protegendo workflows ativos

O filtro `activeWorkflows: false` já está aplicado nos três nós de busca — ele impede que execuções de workflows **ativos** sejam deletadas. Para proteger também workflows inativos específicos, adicione um nó **Filter** após cada `Get many executions` filtrando pelo `workflowId` que deseja preservar.

---

## ⚠️ Avisos importantes

- **A deleção é irreversível.** Não há lixeira nem desfazer — uma vez deletadas, as execuções somem permanentemente.
- **Faça um teste manual primeiro.** Antes de ativar o agendamento, execute manualmente pelo trigger `When clicking 'Execute workflow'` e verifique no log quantas execuções foram deletadas.
- **Instâncias com banco de dados externo (PostgreSQL):** a deleção via API respeita as mesmas regras do banco — o espaço em disco é liberado conforme o VACUUM do PostgreSQL.
- **n8n Cloud:** a API Key e a URL base serão diferentes da versão self-hosted. Verifique a documentação da sua versão.

---

## 🔒 Segurança

- Nunca versione o JSON com a credencial `n8nApi` preenchida
- A API Key do n8n tem acesso total à instância — restrinja quem tem acesso a ela
- Considere criar uma API Key dedicada exclusivamente para este workflow de manutenção

---

## 🏷️ Tags

`n8n` `maintenance` `cleanup` `database` `automation` `devops`
