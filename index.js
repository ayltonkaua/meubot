const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");
const fs = require("fs");
require("dotenv").config();
const { saveGasto, getGastosByUser, findOrCreateUser, deleteGasto } = require("./supabase");
const { detectarCategoria } = require("./classificador");
const { generateAccessCode, setBotSocket } = require("./auth-service");

// Pega a versão instalada do baileys no package.json
const { version: installedVersion } = require("@whiskeysockets/baileys/package.json");
const installedVersionArray = installedVersion.split('.').map(n => Number(n));

// --- CONTROLE DE INSTÂNCIA E MENSAGENS ---
let botSocket = null;
const processedMessages = new Set();

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

  console.log(`✅ Iniciando Baileys instalado: v${installedVersion}`);

  botSocket = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    version: installedVersionArray,
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

    // --- Tratamento de cliques em itens de List Message ---
    if (msg.message.listResponseMessage) {
      const selectedRowId = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
      console.log(`Item de lista clicado: ${selectedRowId}`);

      switch (selectedRowId) {
        case 'id_historico_list': {
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
        }
        case 'id_relatorio_list': {
          const webUrlRelatorio = `https://${process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
          await botSocket.sendMessage(sender, {
            text: `📊 *Acesse seu relatório completo*\n\nPara ver gráficos e estatísticas detalhadas, digite: */codigo*\n\nOu acesse diretamente: ${webUrlRelatorio}`,
          });
          break;
        }
        case 'id_excluir_gasto_list': {
          const userGastos = await getGastosByUser(sender);
          if (userGastos.length === 0) {
            await botSocket.sendMessage(sender, { text: "Você não tem gastos registrados para excluir." });
            return;
          }
          const ultimoGasto = userGastos[0];

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
        }
        default:
          await botSocket.sendMessage(sender, { text: "Opção de lista não reconhecida." });
          break;
      }
      return; // não processar como texto normal
    }
    // --- Fim do tratamento de cliques ---

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

      // --- MENSAGEM DE LISTA de ajuda quando o comando não é reconhecido ---
      const helpSections = [
        {
          title: "Opções Rápidas",
          rows: [
            { id: 'id_historico_list', title: "📜 Ver Histórico", description: "Veja seus últimos gastos" },
            { id: 'id_relatorio_list', title: "📊 Acessar Relatório Web", description: "Abra o painel de controle" },
          ],
        },
      ];

      const helpListMessage = {
        text: `❓ *Como usar o bot:*\n\n• Digite o valor e descrição do gasto\nEx: "Gastei 15 no almoço"`,
        footer: 'Ou escolha uma opção abaixo:',
        title: "Ajuda e Comandos",
        buttonText: "Ver Opções",
        sections: helpSections,
      };

      await botSocket.sendMessage(sender, helpListMessage);
      return;
    }

    const gastoParaSalvar = {
      usuario_id: sender,
      valor: valor,
      categoria: categoria,
      descricao: text,
    };

    await saveGasto(gastoParaSalvar);

    // --- Mensagem de confirmação COM LIST MESSAGE para "Excluir Último Gasto" ---
    const confirmSections = [
      {
        title: "Próximos Passos",
        rows: [
          { id: 'id_excluir_gasto_list', title: '🗑️ Excluir Último Gasto', description: 'Remover o gasto que acabei de registrar' },
          { id: 'id_historico_list', title: '📜 Ver Histórico', description: 'Consultar meus gastos anteriores' },
          { id: 'id_relatorio_list', title: '📊 Acessar Relatório Web', description: 'Ver gráficos e estatísticas' }
        ]
      }
    ];

    const confirmListMessage = {
      text: `✅ *Gasto Registrado!*\n\n💰 Valor: R$ ${valor.toFixed(2)}\n📂 Categoria: ${categoria}\n\nO que você gostaria de fazer a seguir?`,
      footer: 'Escolha uma opção na lista:',
      title: "Ações do Gasto",
      buttonText: "Ver Ações",
      sections: confirmSections
    };

    await botSocket.sendMessage(sender, confirmListMessage);
  });
}

const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("🤖 PoquidaGrana rodando"));
app.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));

require('./web-server');

connectToWhatsApp();
