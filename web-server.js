
const express = require('express');
const path = require('path');
const { generateAccessCode, verifyAccessCode } = require('./auth-service');
const { getGastosByUser, getGastosStats } = require('./supabase');

const app = express();
const port = 5000;

// Configuração do EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Rota principal - login
app.get('/', (req, res) => {
  res.render('login');
});

// Processar login
app.post('/login', async (req, res) => {
  const { whatsapp } = req.body;
  
  if (!whatsapp) {
    return res.render('login', { error: 'Digite seu número do WhatsApp' });
  }
  
  // Formatar número do WhatsApp
  const formattedWhatsapp = whatsapp.replace(/\D/g, '');
  const jid = `${formattedWhatsapp}@s.whatsapp.net`;
  
  try {
    const accessCode = await generateAccessCode(jid);
    res.render('verify-code', { whatsapp: formattedWhatsapp, accessCode });
  } catch (error) {
    res.render('login', { error: 'Erro ao gerar código de acesso' });
  }
});

// Verificar código
app.post('/verify', async (req, res) => {
  const { whatsapp, code } = req.body;
  const jid = `${whatsapp}@s.whatsapp.net`;
  
  try {
    const isValid = await verifyAccessCode(jid, code);
    
    if (isValid) {
      res.redirect(`/dashboard?user=${encodeURIComponent(jid)}`);
    } else {
      res.render('verify-code', { 
        whatsapp, 
        error: 'Código inválido ou expirado',
        accessCode: null 
      });
    }
  } catch (error) {
    res.render('verify-code', { 
      whatsapp, 
      error: 'Erro ao verificar código',
      accessCode: null 
    });
  }
});

// Dashboard
app.get('/dashboard', async (req, res) => {
  const userJid = req.query.user;
  
  if (!userJid) {
    return res.redirect('/');
  }
  
  try {
    const gastos = await getGastosByUser(userJid);
    const stats = await getGastosStats(userJid);
    
    res.render('dashboard', { 
      gastos, 
      stats, 
      userJid,
      whatsapp: userJid.replace('@s.whatsapp.net', '')
    });
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
    res.render('dashboard', { 
      gastos: [], 
      stats: null, 
      userJid,
      error: 'Erro ao carregar dados' 
    });
  }
});

// API para dados do gráfico
app.get('/api/chart-data', async (req, res) => {
  const userJid = req.query.user;
  
  try {
    const stats = await getGastosStats(userJid);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar dados do gráfico' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Servidor web rodando na porta ${port}`);
});
