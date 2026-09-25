// Dash Closer — servidor para o Railway
// Serve o dashboard e repassa as chamadas /api para o Apps Script (Google Sheets).
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || '';     // URL do App da Web do Apps Script (termina em /exec)
const API_TOKEN = process.env.API_TOKEN || ''; // mesmo valor salvo nas Propriedades do script

// Procura o index.html na pasta public/ ou na raiz do projeto (funciona nos dois jeitos de subir no GitHub)
const candidatos = [path.join(__dirname, 'public'), __dirname];
const PASTA = candidatos.find(p => fs.existsSync(path.join(p, 'index.html')));
const INDEX = PASTA ? path.join(PASTA, 'index.html') : null;
console.log(INDEX ? 'Dashboard encontrado em: ' + INDEX : 'ATENÇÃO: index.html não encontrado. Arquivos na raiz: ' + fs.readdirSync(__dirname).join(', '));

app.use(express.json({ limit: '1mb' }));

app.post('/api', async (req, res) => {
  if (!API_URL) {
    return res.status(500).json({ ok: false, erro: 'Variável API_URL não configurada no Railway' });
  }
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...req.body, token: API_TOKEN }),
      redirect: 'follow'
    });
    const text = await r.text();
    try {
      res.json(JSON.parse(text));
    } catch (e) {
      res.status(502).json({
        ok: false,
        erro: 'Resposta inválida do Google Sheets. Confira se o Apps Script foi implantado com acesso "Qualquer pessoa".'
      });
    }
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Falha ao falar com o Google Sheets: ' + err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, index: INDEX, apiConfigurada: !!API_URL }));

app.get('*', (req, res) => {
  if (INDEX) return res.sendFile(INDEX);
  res.status(500).type('text/plain; charset=utf-8').send(
    'Dash Closer: o arquivo index.html não foi encontrado no repositório.\n\n' +
    'Arquivos encontrados na raiz: ' + fs.readdirSync(__dirname).join(', ') + '\n\n' +
    'Suba o index.html dentro de uma pasta chamada "public" (ou na raiz, junto do server.js).'
  );
});

app.listen(PORT, () => console.log('Dash Closer rodando na porta ' + PORT));
