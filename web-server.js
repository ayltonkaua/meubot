// web-server.js
const express = require("express");
const ejs = require("ejs");
const path = require("path");
require('dotenv').config(); // Garante que .env seja carregado
const { getGastosByUser, getGastosStats } = require("./supabase");
const { generateAccessCode, verifyAccessCode, sendCodeViaWhatsApp, isValidAccessCode } = require("./auth-service"); // Importe tudo que precisa do auth-service
const qrcode = require("qrcode"); // Importar a biblioteca qrcode

const app = express();
const PORT = process.env.PORT || 5000; 
const BASE_URL = process.env.WEB_URL || `http://localhost:${PORT}`; // Mantenha isso se usar para logs ou links internos

// Configuração do EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, "public")));

// Para processar dados de formulários
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

  const formattedWhatsapp = whatsapp.replace(/\D/g, '');
  const jid = `${formattedWhatsapp}@s.whatsapp.net`;

  try {
    console.log(`🔄 Gerando código para JID: ${jid}`);
    const accessCode = generateAccessCode(jid);
    console.log(`🔑 Código gerado: ${accessCode}`);

    // Um pequeno atraso para simular o envio, se necessário
    await new Promise(resolve => setTimeout(resolve, 3000));

    await sendCodeViaWhatsApp(jid, accessCode);
    console.log(`✅ Código enviado com sucesso`);

    res.render('verify-code', {
      whatsapp: formattedWhatsapp,
      accessCode: null,
      success: 'Código enviado para seu WhatsApp!',
    });
  } catch (error) {
    console.error('❌ Erro ao enviar código:', error);
    res.render('login', { error: 'Erro ao enviar código. Tente novamente.' });
  }
});

// Verificar código
app.post('/verify', async (req, res) => {
  const { whatsapp, code } = req.body;
  const jid = `${whatsapp}@s.whatsapp.net`;

  console.log(`🔍 Verificando código: ${code} para JID: ${jid}`);

  try {
    // A função isValidAccessCode já está no auth-service
    const isValid = isValidAccessCode(jid, code); 
    console.log(`✅ Código válido: ${isValid}`);

    if (isValid) {
      // Redireciona para o dashboard passando o jid do usuário
      res.redirect(`/dashboard?jid=${encodeURIComponent(jid)}&code=${encodeURIComponent(code)}`);
    } else {
      res.render('verify-code', {
        whatsapp,
        error: 'Código inválido ou expirado',
        accessCode: null,
      });
    }
  } catch (error) {
    console.error('❌ Erro ao verificar código:', error);
    res.render('verify-code', {
      whatsapp,
      error: 'Erro ao verificar código',
      accessCode: null,
    });
  }
});

// Dashboard
app.get('/dashboard', async (req, res) => {
  const userJid = req.query.jid; // Use 'jid' aqui
  const accessCode = req.query.code; // Obtenha o código também

  // Verificação de acesso para o dashboard (importante para segurança)
  if (!userJid || !accessCode || !isValidAccessCode(userJid, accessCode)) {
    console.log(`❌ Acesso negado ao dashboard para JID: ${userJid}, Código: ${accessCode}`);
    return res.status(401).send("Acesso negado ou código inválido/expirado para o dashboard.");
  }

  try {
    const gastos = await getGastosByUser(userJid);
    const stats = await getGastosStats(userJid);

    // Formata os dados para o EJS
    const gastosFormatados = gastos.map((g) => ({
      ...g,
      data_criacao_formatada: new Date(g.criado_em).toLocaleDateString("pt-BR"),
      valor_formatado: parseFloat(g.valor).toFixed(2).replace('.', ',') // Formato BR
    }));

    res.render("dashboard", {
      userJid: userJid,
      gastos: gastosFormatados,
      stats: stats,
      whatsapp: userJid.replace('@s.whatsapp.net', ''),
    });
  } catch (error) {
    console.error('❌ Erro ao carregar dashboard:', error);
    res.status(500).render('dashboard', {
      gastos: [],
      stats: null,
      userJid,
      whatsapp: userJid ? userJid.replace('@s.whatsapp.net', '') : '',
      error: 'Erro ao carregar dados do dashboard.',
    });
  }
});

// API do gráfico
app.get('/api/chart-data', async (req, res) => {
  const userJid = req.query.user;
  // Adicionar verificação de código de acesso aqui também para segurança da API
  // const accessCode = req.query.code;
  // if (!userJid || !accessCode || !isValidAccessCode(userJid, accessCode)) {
  //   return res.status(401).json({ error: 'Acesso negado à API.' });
  // }

  try {
    const stats = await getGastosStats(userJid);
    res.json(stats);
  } catch (error) {
    console.error('❌ Erro na API do gráfico:', error);
    res.status(500).json({ error: 'Erro ao carregar dados do gráfico' });
  }
});

// NOVO ENDPOINT: Para gerar e servir o QR code como imagem
app.get("/qr", async (req, res) => {
  const qrData = req.query.data; // O dado do QR code será passado como parâmetro na URL

  if (!qrData) {
    return res.status(400).send("Dados do QR code não fornecidos.");
  }

  try {
    // Gera o QR code como uma imagem PNG
    const qrPng = await qrcode.toBuffer(qrData);

    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': qrPng.length
    });
    res.end(qrPng);
  } catch (error) {
    console.error("❌ Erro ao gerar QR code como imagem:", error);
    res.status(500).send("Erro interno ao gerar QR code.");
  }
});

// O app Express será exportado e iniciado pelo index.js
module.exports = app;
```