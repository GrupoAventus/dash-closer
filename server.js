// Dash Closer — servidor para o Railway
// Serve o dashboard (pasta public) e repassa as chamadas /api para o Apps Script (Google Sheets).
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || '';     // URL do App da Web do Apps Script (termina em /exec)
const API_TOKEN = process.env.API_TOKEN || ''; // mesmo valor salvo nas Propriedades do script

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('Dash Closer rodando na porta ' + PORT));
