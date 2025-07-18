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
const { saveGasto, getGastosByUser, findOrCreateUser, deleteGasto } = require("./supabase"); // Importe deleteGasto, remova updateGasto
const { detectarCategoria } = require("./classificador");
const { generateAccessCode, setBotSocket } = require("./auth-service");

// --- CONTROLE DE INSTÂNCIA E MENSAGENS ---
let botSocket = null; // Variável para guardar a instância ativa do socket
const processedMessages = new Set();
// NOVO: Mapa para armazenar o estado de edição de cada usuário
// const userEditState = new Map(); // Removido, pois não teremos edição por enquanto


// Garante que a pasta 'auth' exista
if (!fs.existsSync("./auth")) {
  fs.mkdirSync("./auth");
}


async function connectToWhatsApp() {
  if (botSocket) {
    console.log("🔌 Encerrando conexão antiga...");
    try {
      botSocket.end(new Error("Reconectando..."));
    } catch (error) {
      console.log("⚠️ Erro ao encerrar a conexão antiga, mas prosseguindo.");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Iniciando Baileys v${version.join(".")}`);

  botSocket = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    version,
    getMessage: (key) => undefined,
  });

  botSocket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
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
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log("❌ Desconectado permanentemente. Não será possível reconectar.");
      }
    } else if (connection === "open") {
      console.log("✅ Conexão estabelecida com o WhatsApp!");
      console.log(`👤 Usuário conectado: ${botSocket.user?.name || 'Desconhecido'}`);
      console.log(`📱 Número do bot: ${botSocket.user?.id || 'N/A'}`);
      
      setBotSocket(botSocket);
      
      setTimeout(async () => {
        console.log("🔧 Socket configurado e pronto para envio de códigos");
        
        try {
          console.log("🔍 Testando conectividade do bot...");
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

    const usuario = await findOrCreateUser(sender);
    if (!usuario) {
        console.log(`❌ Não foi possível encontrar ou criar o usuário ${sender}. Abortando processamento.`);
        await botSocket.sendMessage(sender, { text: "⚠️ Ocorreu um erro ao identificar seu usuário. Por favor, tente novamente mais tarde." });
        return;
    }

    // --- Tratamento de cliques em botões de resposta rápida ---
    if (msg.message.buttonsResponseMessage) {
        const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
        console.log(`Botão clicado: ${buttonId}`);

        switch (buttonId) {
            case 'id_historico':
                const gastos = await getGastosByUser(sender);
                if (gastos.length === 0) {
                    await botSocket.sendMessage(sender, { text: "Você ainda não tem gastos registrados." });
                    return;
                }
                let mensagemHistorico = "📊 *Seu Histórico de Gastos (Últimos 10):*\n\n";
                let totalGastosExibidos = 0;
                const ultimosGastos = gastos.slice(0, 10);

                ultimosGastos.forEach(gasto => {
                    const data = new Date(gasto.criado_em).toLocaleDateString('pt-BR');
                    mensagemHistorico += `• ${data} - R$ ${parseFloat(gasto.valor).toFixed(2)} (${gasto.categoria})\n`;
                    totalGastosExibidos += parseFloat(gasto.valor);
                });

                mensagemHistorico += `\n*Total exibido: R$ ${totalGastosExibidos.toFixed(2)}*`;
                mensagemHistorico += `\n\nPara ver o relatório completo: */codigo*`;
                await botSocket.sendMessage(sender, { text: mensagemHistorico });
                break;
            case 'id_relatorio':
                const webUrlRelatorio = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
                await botSocket.sendMessage(sender, {
                    text: `📊 *Acesse seu relatório completo*\n\nPara ver gráficos e estatísticas detalhadas, digite: */codigo*\n\nOu acesse diretamente: ${webUrlRelatorio}`,
                });
                break;
            case 'id_excluir_gasto': // NOVO: Lógica para excluir gasto
                const userGastos = await getGastosByUser(sender);
                if (userGastos.length === 0) {
                    await botSocket.sendMessage(sender, { text: "Você não tem gastos registrados para excluir." });
                    return;
                }
                const ultimoGasto = userGastos[0]; // O primeiro item é o mais recente devido à ordenação
                
                const deleteResult = await deleteGasto(ultimoGasto.id);

                if (deleteResult.success) {
                    await botSocket.sendMessage(sender, {
                        text: `🗑️ *Gasto Excluído!*\n\nO último gasto (R$ ${parseFloat(ultimoGasto.valor).toFixed(2)} - ${ultimoGasto.categoria}) foi removido com sucesso.`
                    });
                } else {
                    await botSocket.sendMessage(sender, {
                        text: `❌ Erro ao excluir o gasto: ${deleteResult.error}`
                    });
                }
                break;
            default:
                await botSocket.sendMessage(sender, { text: "Opção de botão não reconhecida." });
                break;
        }
        return; // Retorna para não processar o clique do botão como uma mensagem de texto normal
    }


    // Comando para gerar código de acesso ao sistema web
    if (text.includes("/codigo") || text.includes("/acesso") || text.includes("/web")) {
      const accessCode = generateAccessCode(sender);
      const webUrl = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
      await botSocket.sendMessage(sender, {
        text: `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${accessCode}*\n\nAcesse: ${webUrl}\n\n⏰ Este código expira em 10 minutos.`,
      });
      return;
    }

    // Comando para relatório
    if (text.includes("/relatorio") || text.includes("/resumo")) {
      const webUrlRelatorio = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
      await botSocket.sendMessage(sender, {
        text: `📊 *Acesse seu relatório completo*\n\nPara ver gráficos e estatísticas detalhadas, digite: */codigo*\n\nOu acesse diretamente: ${webUrlRelatorio}`,
      });
      return;
    }

    // Comando: Puxar todos os gastos do usuário
    if (text.includes("/historico") || text.includes("/meusgastos")) {
        console.log(`🔍 Buscando histórico de gastos para ${sender}`);
        const gastos = await getGastosByUser(sender);

        if (gastos.length === 0) {
            await botSocket.sendMessage(sender, { text: "Você ainda não tem gastos registrados." });
            return;
        }

        let mensagemHistorico = "📊 *Seu Histórico de Gastos (Últimos 10):*\n\n";
        let totalGastosExibidos = 0;
        const ultimosGastos = gastos.slice(0, 10);

        ultimosGastos.forEach(gasto => {
            const data = new Date(gasto.criado_em).toLocaleDateString('pt-BR');
            mensagemHistorico += `• ${data} - R$ ${parseFloat(gasto.valor).toFixed(2)} (${gasto.categoria})\n`;
            totalGastosExibidos += parseFloat(gasto.valor);
        });

        mensagemHistorico += `\n*Total exibido: R$ ${totalGastosExibidos.toFixed(2)}*`;
        mensagemHistorico += `\n\nPara ver o relatório completo: */codigo*`;

        await botSocket.sendMessage(sender, { text: mensagemHistorico });
        return;
    }


    const valorMatch = text.match(/(\d+[\.,]?\d*)/);
    const valor = valorMatch ? parseFloat(valorMatch[0].replace(",", ".")) : null;
    const categoria = detectarCategoria(text);

    if (!valor || !categoria) {
      console.log("⚠️ Não foi possível identificar um valor e uma categoria.");
      
      const helpButtons = [
        { buttonId: 'id_historico', buttonText: { displayText: '📜 Ver Histórico' }, type: 1 },
        { buttonId: 'id_relatorio', buttonText: { displayText: '📊 Ver Relatório Web' }, type: 1 },
      ];

      const helpButtonMessage = {
        text: `❓ *Como usar o bot:*\n\n• Digite o valor e descrição do gasto\nEx: "Gastei 15 no almoço"`,
        footer: 'Ou escolha uma opção:',
        buttons: helpButtons,
        headerType: 1
      };

      await botSocket.sendMessage(sender, helpButtonMessage);
      return;
    }

    const gastoParaSalvar = {
      usuario_id: sender,
      valor: valor,
      categoria: categoria,
      descricao: text,
    };

    await saveGasto(gastoParaSalvar);

    // --- NOVO: Mensagem de confirmação com botão "Excluir Último Gasto" ---
    const deleteButton = [
        { buttonId: 'id_excluir_gasto', buttonText: { displayText: '🗑️ Excluir Último Gasto' }, type: 1 }
    ];

    const confirmMessageWithButton = {
        text: `✅ *Gasto Registrado!*\n\n💰 Valor: R$ ${valor.toFixed(2)}\n📂 Categoria: ${categoria}\n\n📊 Para ver relatórios: */codigo*\n📜 Para ver seus últimos gastos: */historico*`,
        footer: 'O que você gostaria de fazer a seguir?',
        buttons: deleteButton,
        headerType: 1
    };

    await botSocket.sendMessage(sender, confirmMessageWithButton);
  });
}

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000; 

app.get("/", (req, res) => res.send("🤖 PoquidaGrana rodando"));
app.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));


require('./web-server');

connectToWhatsApp();