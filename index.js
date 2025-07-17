const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");
const fs = require("fs");
require("dotenv").config();
const { saveGasto } = require("./supabase");
const { detectarCategoria } = require("./classificador");
const { generateAccessCode, setBotSocket } = require("./auth-service");

// --- CONTROLE DE INSTÂNCIA E MENSAGENS ---
let botSocket = null; // Variável para guardar a instância ativa do socket
const processedMessages = new Set();



// Garante que a pasta 'auth' exista
if (!fs.existsSync("./auth")) {
  fs.mkdirSync("./auth");
}


async function connectToWhatsApp() {
  // Se já existe uma instância do socket, encerra ela completamente antes de criar uma nova
  if (botSocket) {
    console.log("🔌 Encerrando conexão antiga...");
    try {
      // Envia um evento de encerramento para a instância antiga
      botSocket.end(new Error("Reconectando..."));
    } catch (error) {
      console.log("⚠️ Erro ao encerrar a conexão antiga, mas prosseguindo.");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Iniciando Baileys v${version.join(".")}`);

  // Atribui a nova instância à nossa variável de controle
  botSocket = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    version,
    getMessage: (key) => undefined,
  });

  // --- OUVINTES DE EVENTOS DA NOVA INSTÂNCIA ---

  botSocket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update; // Adicionado 'qr' aqui

    if (qr) { // Lógica para exibir QR code se necessário
        console.log("\n📸 Escaneie o QR code abaixo no WhatsApp:");
        console.log(qr);
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error instanceof Boom &&
        lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(
        "Conexão fechada.",
        `Erro: ${lastDisconnect?.error?.message}.`,
        `Reconectando: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        // Chama a função principal novamente para criar uma nova instância limpa
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log("❌ Desconectado permanentemente. Não será possível reconectar.");
      }
    } else if (connection === "open") {
      console.log("✅ Conexão estabelecida com o WhatsApp!");
      console.log(`👤 Usuário conectado: ${botSocket.user?.name || 'Desconhecido'}`);
      console.log(`📱 Número do bot: ${botSocket.user?.id || 'N/A'}`);
      
      // Define o socket no auth-service para envio de códigos
      setBotSocket(botSocket);
      
      // Aguarda mais tempo para garantir que tudo esteja completamente pronto
      setTimeout(async () => {
        console.log("🔧 Socket configurado e pronto para envio de códigos");
        
        // Teste de conectividade
        try {
          console.log("🔍 Testando conectividade do bot...");
          // Envia uma mensagem de teste para si mesmo
          await botSocket.sendMessage(botSocket.user.id, {
            text: "🤖 Bot online e pronto para enviar códigos!"
          });
          console.log("✅ Teste de conectividade realizado com sucesso");
        } catch (testError) {
          console.error("⚠️ Aviso: Possível problema de conectividade:", testError.message);
        }
      }, 5000);
    }
  });

  botSocket.ev.on("creds.update", saveCreds);

  botSocket.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.id) return;

    // Ignora mensagens enviadas pelo próprio bot
    if (msg.key.fromMe) {
      console.log("🤖 Ignorando mensagem enviada pelo próprio bot");
      return;
    }

    const messageId = msg.key.id;
    if (processedMessages.has(messageId)) {
      console.log(`🚫 Mensagem duplicada ignorada: ${messageId}`);
      return;
    }
    processedMessages.add(messageId);
    setTimeout(() => processedMessages.delete(messageId), 60000);

    const sender = msg.key.remoteJid;
    let text = "";

    if (msg.message.conversation) {
      text = msg.message.conversation;
    } else if (msg.message.extendedTextMessage?.text) {
      text = msg.message.extendedTextMessage.text;
    } else if (msg.message.imageMessage?.caption) {
      text = msg.message.imageMessage.caption;
    }

    if (!text) return;
    text = text.toLowerCase();

    console.log(`📩 Processando: "${text}" de ${sender}`);

    // Comando para gerar código de acesso ao sistema web
    if (text.includes("/codigo") || text.includes("/acesso") || text.includes("/web")) {
      const accessCode = generateAccessCode(sender);
      // Use as variáveis de ambiente corretas para a URL do Railway
      const webUrl = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`; // Ajustado para Railway
      await botSocket.sendMessage(sender, {
        text: `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${accessCode}*\n\nAcesse: ${webUrl}\n\n⏰ Este código expira em 10 minutos.`,
      });
      return;
    }

    // Comando para relatório
    if (text.includes("/relatorio") || text.includes("/resumo")) {
      // Use as variáveis de ambiente corretas para a URL do Railway
      const webUrl = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`; // Ajustado para Railway
      await botSocket.sendMessage(sender, {
        text: `📊 *Acesse seu relatório completo*\n\nPara ver gráficos e estatísticas detalhadas, digite: */codigo*\n\nOu acesse diretamente: ${webUrl}`,
      });
      return;
    }

    const valorMatch = text.match(/(\d+[\.,]?\d*)/);
    const valor = valorMatch ? parseFloat(valorMatch[0].replace(",", ".")) : null;
    const categoria = detectarCategoria(text);

    if (!valor || !categoria) {
      console.log("⚠️ Não foi possível identificar um valor e uma categoria.");
      await botSocket.sendMessage(sender, {
        text: `❓ *Como usar o bot:*\n\n• Digite o valor e descrição do gasto\nEx: "Gastei 15 no almoço"\n\n• Para ver relatórios: */codigo*\n• Para resumo: */relatorio*`,
      });
      return;
    }

    const gastoParaSalvar = {
      usuario_id: sender,
      valor: valor,
      categoria: categoria,
      descricao: text,
    };

    await saveGasto(gastoParaSalvar);

    await botSocket.sendMessage(sender, {
      text: `✅ *Gasto Registrado!*\n\n💰 Valor: R$ ${valor.toFixed(2)}\n📂 Categoria: ${categoria}\n\n📊 Para ver relatórios: */codigo*`,
    });
  });
}

const express = require("express");
const app = express();

// A porta deve ser a que o Railway expõe, geralmente a PORT do ambiente.
// O Railway injeta a variável de ambiente PORT.
const PORT = process.env.PORT || 3000; 

app.get("/", (req, res) => res.send("🤖 PoquidaGrana rodando"));
app.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));


// Inicia o servidor web (certifique-se de que web-server.js também esteja usando process.env.PORT)
require('./web-server');

// Inicia o bot pela primeira vez
connectToWhatsApp();