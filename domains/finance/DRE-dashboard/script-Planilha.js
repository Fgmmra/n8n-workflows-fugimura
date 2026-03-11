
const SHEET_NAME = 'Sheet1'; // Altere se sua aba tiver outro nome

function doGet(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const data = getFinancialData();
    output.setContent(JSON.stringify({ status: 'ok', data, updated: new Date().toISOString() }));
  } catch (err) {
    output.setContent(JSON.stringify({ status: 'error', message: err.message }));
  }

  // Permite acesso cross-origin (necessário para o dashboard externo)
  return output;
}

function getFinancialData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();

  // Cabeçalhos esperados (linha 0)
  // Categoria / empresa contratante | Banco | Status | VALOR | CNPJ/CPF | DATA | SALDO TOTAL
  const headers = rows[0].map(h => String(h).trim());
  const idxCat    = headers.findIndex(h => h.toLowerCase().includes('categoria'));
  const idxBanco  = headers.findIndex(h => h.toLowerCase() === 'banco');
  const idxStatus = headers.findIndex(h => h.toLowerCase() === 'status');
  const idxValor  = headers.findIndex(h => h.toLowerCase() === 'valor');
  const idxData   = headers.findIndex(h => h.toLowerCase() === 'data');
  const idxSaldo  = headers.findIndex(h => h.toLowerCase().includes('saldo total'));

  const transactions = [];
  let saldoInicial = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cat    = String(row[idxCat]  || '').trim();
    const status = String(row[idxStatus] || '').trim();
    const valor  = parseFloat(row[idxValor]) || 0;
    const data   = String(row[idxData]  || '').trim();
    const banco  = String(row[idxBanco] || '').trim();
    const saldo  = row[idxSaldo];

    if (!cat && !valor) continue;

    if (saldo && saldoInicial === null) {
      saldoInicial = parseFloat(saldo);
    }

    transactions.push({ cat, banco, status, valor, data });
  }

  return processData(transactions, saldoInicial);
}

function processData(tx, saldoInicial) {
  // ── Filtros de linhas de saldo/investimento (não operacionais)
  const isBalance = cat => /saldo|aplic aut mais|res aplic|sdo cta|rend pago|apl aplic/i.test(cat);

  const ops = tx.filter(t => !isBalance(t.cat));

  // ── Categorização
  function categorize(cat) {
    const c = cat.toUpperCase();
    if (/TRIBUT|IMPOSTO|FGTS|INSS|IRRF/.test(c))           return 'Tributos';
    if (/FORNECEDOR|SISPAG/.test(c))                        return 'Fornecedores';
    if (/GIRO PARCEL|EMPRESTIMO|FINANC/.test(c))            return 'Financeiro';
    if (/^TAR |TED|PIX|IOF/.test(c))                       return 'Tarifas Bancárias';
    if (/SAQUE|ATM/.test(c))                                return 'Saques';
    if (/MOV TIT COB|COBRAN/.test(c))                       return 'Rec. Clientes';
    if (/RESGATE|CDB|AQUISICAO/.test(c))                    return 'Investimentos';
    if (/SALARIO|FOLHA|RH/.test(c))                         return 'Pessoal';
    return 'Outros';
  }

  // ── Por mês
  const byMonth = {};
  ops.forEach(t => {
    const parts = t.data.split('/');
    const mes = parts.length >= 2 ? parts[1] : parts[0];
    if (!byMonth[mes]) byMonth[mes] = { rec: 0, pag: 0, count: 0 };
    if (t.status === 'Recebimento') byMonth[mes].rec += t.valor;
    else if (t.status === 'Pagamento') byMonth[mes].pag += Math.abs(t.valor);
    byMonth[mes].count++;
  });

  // ── Por categoria
  const catPag = {}, catRec = {};
  ops.forEach(t => {
    const cat = categorize(t.cat);
    if (t.status === 'Pagamento') {
      catPag[cat] = (catPag[cat] || 0) + Math.abs(t.valor);
    } else if (t.status === 'Recebimento') {
      catRec[cat] = (catRec[cat] || 0) + t.valor;
    }
  });

  // ── Top 10 pagamentos
  const pagMap = {};
  ops.filter(t => t.status === 'Pagamento').forEach(t => {
    pagMap[t.cat] = (pagMap[t.cat] || 0) + Math.abs(t.valor);
  });
  const topPag = Object.entries(pagMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([n, v]) => ({ n, v }));

  // ── Top 10 recebimentos
  const recMap = {};
  ops.filter(t => t.status === 'Recebimento').forEach(t => {
    recMap[t.cat] = (recMap[t.cat] || 0) + t.valor;
  });
  const topRec = Object.entries(recMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([n, v]) => ({ n, v }));

  // ── Diário (até 60 pontos para não pesar)
  const dailyMap = {};
  ops.forEach(t => {
    if (!dailyMap[t.data]) dailyMap[t.data] = { r: 0, p: 0 };
    if (t.status === 'Recebimento') dailyMap[t.data].r += t.valor;
    else if (t.status === 'Pagamento') dailyMap[t.data].p += Math.abs(t.valor);
  });
  const daily = Object.entries(dailyMap)
    .sort((a, b) => {
      const [da, ma] = a[0].split('/').map(Number);
      const [db, mb] = b[0].split('/').map(Number);
      return ma !== mb ? ma - mb : da - db;
    })
    .slice(0, 60)
    .map(([d, v]) => ({ d, r: Math.round(v.r), p: Math.round(v.p) }));

  // ── Totais gerais
  const totalRec = ops.filter(t => t.status === 'Recebimento').reduce((a, t) => a + t.valor, 0);
  const totalPag = ops.filter(t => t.status === 'Pagamento').reduce((a, t) => a + Math.abs(t.valor), 0);

  return {
    saldoInicial,
    totalRec: Math.round(totalRec),
    totalPag: Math.round(totalPag),
    resultado: Math.round(totalRec - totalPag),
    byMonth,
    catPag,
    catRec,
    topPag,
    topRec,
    daily,
    meses: Object.keys(byMonth).sort()
  };
}
