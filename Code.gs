/**
 * DASH CLOSER — Grupo Aventus
 * Backend em Google Apps Script. Todos os dados ficam nesta planilha.
 *
 * Abas criadas automaticamente: Closers, Stages, Meses, Vendas, Descontos, Taxas
 * NÃO renomeie as abas nem os cabeçalhos da linha 1.
 */

var SHEETS = {
  Closers:   ['id', 'nome', 'ativo', 'criadoEm'],
  Stages:    ['id', 'nome', 'fixo', 'variavel', 'meta', 'gatilho', 'pctBase', 'incremento',
              'redAbaixo', 'yellowAbaixo', 'recuperacao', 'criadoEm'],
  Meses:     ['id', 'closerId', 'mes', 'stageId', 'stageNome', 'fixo', 'variavel', 'meta', 'gatilho',
              'pctBase', 'incremento', 'redAbaixo', 'yellowAbaixo', 'recuperacao', 'status',
              'leads', 'agendadas', 'noshow', 'feitas', 'criadoEm', 'fechadoEm'],
  Vendas:    ['id', 'closerId', 'mesId', 'data', 'cliente', 'produto', 'valorBruto', 'forma',
              'parcelas', 'taxa', 'valorLiquido', 'obs', 'criadoEm'],
  Descontos: ['id', 'closerId', 'mesId', 'data', 'descricao', 'valor', 'criadoEm'],
  Taxas:     ['parcelas', 'taxa']
};

// Colunas que devem ser guardadas como texto (evita o Sheets converter "2026-09" em data)
var TEXT_COLS = ['id', 'closerId', 'mesId', 'stageId', 'mes', 'data', 'nome', 'stageNome', 'cliente',
                 'produto', 'forma', 'obs', 'descricao', 'status', 'ativo', 'criadoEm', 'fechadoEm'];

var NUM_FIELDS = ['fixo', 'variavel', 'meta', 'gatilho', 'pctBase', 'incremento', 'redAbaixo',
                  'yellowAbaixo', 'recuperacao', 'leads', 'agendadas', 'noshow', 'feitas',
                  'valorBruto', 'parcelas', 'taxa', 'valorLiquido', 'valor'];

var STAGE_PARAMS = ['fixo', 'variavel', 'meta', 'gatilho', 'pctBase', 'incremento',
                    'redAbaixo', 'yellowAbaixo', 'recuperacao'];

var FUNIL_CAMPOS = ['leads', 'agendadas', 'noshow', 'feitas'];

/* ------------------------------------------------------------------ */
/* Entrada HTTP                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  return json_({ ok: true, app: 'dash-closer', hora: new Date().toISOString() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (token && body.token !== token) return json_({ ok: false, erro: 'Token inválido' });

    setup_();
    var action = body.action;
    var p = body.payload || {};
    var handler = ACTIONS[action];
    if (!handler) return json_({ ok: false, erro: 'Ação desconhecida: ' + action });

    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var data = handler(p);
      return json_({ ok: true, data: data });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, erro: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

var ACTIONS = {
  getAll: function () {
    return {
      closers: readAll_('Closers'),
      stages: readAll_('Stages'),
      meses: readAll_('Meses'),
      vendas: readAll_('Vendas'),
      descontos: readAll_('Descontos'),
      taxas: readAll_('Taxas')
    };
  },

  /* ---------- Closers ---------- */
  createCloser: function (p) {
    if (!p.nome) throw new Error('Informe o nome do closer');
    if (!p.mes) throw new Error('Informe o mês inicial');
    var stage = findById_('Stages', p.stageId);
    if (!stage) throw new Error('Stage não encontrado');
    var closer = { id: uid_(), nome: String(p.nome).trim(), ativo: 'sim', criadoEm: now_() };
    insert_('Closers', closer);
    var mes = novoMes_(closer.id, p.mes, stage, p.meta);
    return { closer: closer, mes: mes };
  },

  updateCloser: function (p) {
    var c = findById_('Closers', p.id);
    if (!c) throw new Error('Closer não encontrado');
    if (p.nome !== undefined) c.nome = String(p.nome).trim();
    if (p.ativo !== undefined) c.ativo = p.ativo;
    update_('Closers', c);
    return c;
  },

  deleteCloser: function (p) {
    // Remove o closer e todos os dados dele
    removeWhere_('Vendas', function (r) { return r.closerId === p.id; });
    removeWhere_('Descontos', function (r) { return r.closerId === p.id; });
    removeWhere_('Meses', function (r) { return r.closerId === p.id; });
    removeWhere_('Closers', function (r) { return r.id === p.id; });
    return { id: p.id };
  },

  /* ---------- Stages ---------- */
  saveStage: function (p) {
    if (!p.nome) throw new Error('Informe o nome do stage');
    var s = p.id ? findById_('Stages', p.id) : null;
    var novo = !s;
    if (novo) s = { id: uid_(), criadoEm: now_() };
    s.nome = String(p.nome).trim();
    STAGE_PARAMS.forEach(function (k) { s[k] = num_(p[k]); });
    if (novo) insert_('Stages', s); else update_('Stages', s);
    return s;
  },

  deleteStage: function (p) {
    var emUso = readAll_('Meses').some(function (m) { return m.stageId === p.id && m.status === 'aberto'; });
    if (emUso) throw new Error('Este stage está em uso em um mês aberto. Troque o stage do mês antes de excluir.');
    removeWhere_('Stages', function (r) { return r.id === p.id; });
    return { id: p.id };
  },

  /* ---------- Meses ---------- */
  openMonth: function (p) {
    var closer = findById_('Closers', p.closerId);
    if (!closer) throw new Error('Closer não encontrado');
    var stage = findById_('Stages', p.stageId);
    if (!stage) throw new Error('Stage não encontrado');
    var existe = readAll_('Meses').some(function (m) { return m.closerId === p.closerId && m.mes === p.mes; });
    if (existe) throw new Error('Esse closer já tem o mês ' + p.mes + ' cadastrado');
    // Fecha os meses abertos do closer
    readAll_('Meses').forEach(function (m) {
      if (m.closerId === p.closerId && m.status === 'aberto') {
        m.status = 'fechado';
        m.fechadoEm = now_();
        update_('Meses', m);
      }
    });
    return novoMes_(p.closerId, p.mes, stage, p.meta);
  },

  updateMonth: function (p) {
    var m = findById_('Meses', p.id);
    if (!m) throw new Error('Mês não encontrado');
    if (p.stageId && p.stageId !== m.stageId) {
      var st = findById_('Stages', p.stageId);
      if (!st) throw new Error('Stage não encontrado');
      m.stageId = st.id;
      m.stageNome = st.nome;
      STAGE_PARAMS.forEach(function (k) { m[k] = num_(st[k]); });
    }
    if (p.meta !== undefined && p.meta !== '') m.meta = num_(p.meta);
    if (p.status === 'aberto' || p.status === 'fechado') {
      if (p.status === 'aberto') {
        // Só um mês aberto por closer
        readAll_('Meses').forEach(function (o) {
          if (o.closerId === m.closerId && o.id !== m.id && o.status === 'aberto') {
            o.status = 'fechado'; o.fechadoEm = now_(); update_('Meses', o);
          }
        });
        m.fechadoEm = '';
      } else {
        m.fechadoEm = now_();
      }
      m.status = p.status;
    }
    update_('Meses', m);
    return m;
  },

  incFunnel: function (p) {
    if (FUNIL_CAMPOS.indexOf(p.campo) < 0) throw new Error('Campo do funil inválido');
    var m = findById_('Meses', p.mesId);
    if (!m) throw new Error('Mês não encontrado');
    var novo = Math.max(0, num_(m[p.campo]) + num_(p.delta));
    m[p.campo] = novo;
    update_('Meses', m);
    return m;
  },

  setFunnel: function (p) {
    if (FUNIL_CAMPOS.indexOf(p.campo) < 0) throw new Error('Campo do funil inválido');
    var m = findById_('Meses', p.mesId);
    if (!m) throw new Error('Mês não encontrado');
    m[p.campo] = Math.max(0, Math.round(num_(p.valor)));
    update_('Meses', m);
    return m;
  },

  /* ---------- Vendas ---------- */
  addSale: function (p) {
    var m = findById_('Meses', p.mesId);
    if (!m) throw new Error('Mês não encontrado');
    var bruto = num_(p.valorBruto);
    if (bruto <= 0) throw new Error('Informe o valor da venda');
    var forma = p.forma === 'cartao' ? 'cartao' : 'pix';
    var parcelas = forma === 'cartao' ? Math.max(1, Math.round(num_(p.parcelas) || 1)) : 1;
    var taxa = 0;
    if (forma === 'cartao') {
      var t = readAll_('Taxas').filter(function (r) { return num_(r.parcelas) === parcelas; })[0];
      taxa = t ? num_(t.taxa) : 0;
    }
    var liquido = Math.round(bruto * (1 - taxa / 100) * 100) / 100;
    var v = {
      id: uid_(), closerId: m.closerId, mesId: m.id, data: p.data || now_().slice(0, 10),
      cliente: p.cliente || '', produto: p.produto || '', valorBruto: bruto, forma: forma,
      parcelas: parcelas, taxa: taxa, valorLiquido: liquido, obs: p.obs || '', criadoEm: now_()
    };
    insert_('Vendas', v);
    return v;
  },

  deleteSale: function (p) {
    removeWhere_('Vendas', function (r) { return r.id === p.id; });
    return { id: p.id };
  },

  /* ---------- Descontos ---------- */
  addDiscount: function (p) {
    var m = findById_('Meses', p.mesId);
    if (!m) throw new Error('Mês não encontrado');
    var valor = num_(p.valor);
    if (valor <= 0) throw new Error('Informe o valor do desconto');
    var d = {
      id: uid_(), closerId: m.closerId, mesId: m.id, data: p.data || now_().slice(0, 10),
      descricao: p.descricao || '', valor: valor, criadoEm: now_()
    };
    insert_('Descontos', d);
    return d;
  },

  deleteDiscount: function (p) {
    removeWhere_('Descontos', function (r) { return r.id === p.id; });
    return { id: p.id };
  },

  /* ---------- Taxas do cartão ---------- */
  saveTaxas: function (p) {
    var sh = sheet_('Taxas');
    var lista = (p.taxas || []).map(function (t) { return [num_(t.parcelas), num_(t.taxa)]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
    if (lista.length) sh.getRange(2, 1, lista.length, 2).setValues(lista);
    return readAll_('Taxas');
  }
};

/* ------------------------------------------------------------------ */
/* Regras auxiliares                                                   */
/* ------------------------------------------------------------------ */

function novoMes_(closerId, mes, stage, meta) {
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new Error('Mês inválido (use AAAA-MM)');
  var m = {
    id: uid_(), closerId: closerId, mes: String(mes), stageId: stage.id, stageNome: stage.nome,
    status: 'aberto', leads: 0, agendadas: 0, noshow: 0, feitas: 0, criadoEm: now_(), fechadoEm: ''
  };
  STAGE_PARAMS.forEach(function (k) { m[k] = num_(stage[k]); });
  if (meta !== undefined && meta !== null && meta !== '' && num_(meta) > 0) m.meta = num_(meta);
  insert_('Meses', m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Camada da planilha                                                  */
/* ------------------------------------------------------------------ */

function setup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var cols = SHEETS[name];
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
      cols.forEach(function (c, i) {
        if (TEXT_COLS.indexOf(c) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
      if (name === 'Stages') {
        insert_('Stages', {
          id: uid_(), nome: 'Stage 1', fixo: 2000, variavel: 4000, meta: 30000, gatilho: 60,
          pctBase: 40, incremento: 1.5, redAbaixo: 40, yellowAbaixo: 60, recuperacao: 85, criadoEm: now_()
        });
      }
      if (name === 'Taxas') {
        var rows = [];
        for (var i = 1; i <= 12; i++) rows.push([i, 0]);
        sh.getRange(2, 1, rows.length, 2).setValues(rows);
      }
    }
  });
}

/** Rode esta função uma vez pelo editor para criar as abas. */
function instalar() {
  setup_();
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function readAll_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values[0] || SHEETS[name];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;
    var obj = {};
    head.forEach(function (h, i) {
      var v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (NUM_FIELDS.indexOf(h) >= 0) v = num_(v);
      else v = v === null || v === undefined ? '' : String(v);
      obj[h] = v;
    });
    out.push(obj);
  }
  return out;
}

function findById_(name, id) {
  if (!id) return null;
  return readAll_(name).filter(function (r) { return r.id === id; })[0] || null;
}

function toRow_(name, obj) {
  return SHEETS[name].map(function (c) {
    var v = obj[c];
    return v === undefined || v === null ? '' : v;
  });
}

function insert_(name, obj) {
  sheet_(name).appendRow(toRow_(name, obj));
}

function rowIndex_(name, id) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function update_(name, obj) {
  var r = rowIndex_(name, obj.id);
  if (r < 0) throw new Error('Registro não encontrado em ' + name);
  sheet_(name).getRange(r, 1, 1, SHEETS[name].length).setValues([toRow_(name, obj)]);
}

function removeWhere_(name, fn) {
  var sh = sheet_(name);
  var rows = readAll_(name);
  // apaga de baixo pra cima
  for (var i = rows.length - 1; i >= 0; i--) {
    if (fn(rows[i])) {
      var r = rowIndex_(name, rows[i].id);
      if (r > 0) sh.deleteRow(r);
    }
  }
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).trim();
  // aceita "1.234,56" e "1234.56"
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
