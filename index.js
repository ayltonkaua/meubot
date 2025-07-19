// index.js
const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");
const fs = require("fs");
require("dotenv").config();
const qrcodeTerminal = require("qrcode-terminal");

const {
  saveGasto,
  getGastosByUser,
  findOrCreateUser,
  deleteGasto,
} = require("./supabase");
const { detectarCategoria } = require("./classificador");
const { generateAccessCode, setBotSocket } = require("./auth-service");
const { getAIIntent } = require("./groq-service");

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

  const { version } = await fetchLatestBaileysVersion();
  console.log(`✅ Usando versão do protocolo WhatsApp Web: v${version.join('.')}`);

  botSocket = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    version: version,
    printQRInTerminal: false,
    browser: ["PoquidaGrana", "Desktop", "1.0.0"],
    getMessage: (key) => undefined,
  });

  botSocket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📸 Escaneie o QR code abaixo no WhatsApp:");
      qrcodeTerminal.generate(qr, { small: true });

      const BASE_RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
      let qrImageUrl;

      if (BASE_RAILWAY_URL) {
        qrImageUrl = `https://${BASE_RAILWAY_URL}/qr?data=${encodeURIComponent(qr)}`;
      } else {
        qrImageUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app/qr?data=${encodeURIComponent(qr)}`;
      }

      console.log(`\nOu acesse este link para a imagem do QR Code: ${qrImageUrl}`);
      console.log(`(Copie o link e abra no navegador para escanear ou baixar a imagem)`);
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
      console.log(`👤 Usuário conectado: ${botSocket.user?.name || "Desconhecido"}`);
      console.log(`📱 Número do bot: ${botSocket.user?.id || "N/A"}`);

      setBotSocket(botSocket);

      setTimeout(async () => {
        console.log("🔧 Socket configurado e pronto para envio de códigos");
        try {
          console.log("🔍 Testando conectividade do bot...");
          await botSocket.sendMessage(botSocket.user.id, {
            text: "🤖 Bot online e pronto para enviar códigos!",
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

    // Adicionado para capturar texto de cliques em lista
    if (msg.message.listResponseMessage) {
        text = msg.message.listResponseMessage.title; // Usa o título da lista como texto de contexto
    }

    if (!text) return;

    console.log(`📩 Processando: "${text}" de ${sender}`);

    // ======================================================================
    // MELHORIA: Bloco try/catch para garantir que o bot não trave
    // ======================================================================
    try {
      const usuario = await findOrCreateUser(sender);
      if (!usuario) {
        console.log(`❌ Não foi possível encontrar ou criar o usuário ${sender}. Abortando processamento.`);
        await botSocket.sendMessage(sender, { text: "⚠️ Ocorreu um erro ao identificar seu usuário. Por favor, tente novamente mais tarde." });
        return;
      }

      let intent = 'outro';
      let entities = {};

      if (msg.message.listResponseMessage) {
        const selectedRowId = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
        console.log(`Item de lista clicado: ${selectedRowId}`);
        switch (selectedRowId) {
          case 'id_historico_list': intent = 'ver_historico'; break;
          case 'id_relatorio_list': intent = 'ver_relatorio_web'; break;
          case 'id_excluir_gasto_list': intent = 'excluir_gasto'; break;
          case 'id_ajuda_list': intent = 'ajuda'; break;
          default: intent = 'outro'; break;
        }
      } else {
        const groqResponse = await getAIIntent(text);
        intent = groqResponse.intent;
        entities = groqResponse.entities;
        console.log(`Groq AI - Intenção: ${intent}, Entidades: ${JSON.stringify(entities)}`);
      }

      switch (intent) {
        case 'registrar_gasto': {
          const valor = entities.valor;
          const categoria = entities.categoria || detectarCategoria(text);
          const descricao = entities.descricao || text;

          if (valor && categoria) {
            const gastoParaSalvar = {
              usuario_id: sender,
              valor: parseFloat(valor),
              categoria: categoria,
              descricao: descricao,
            };
            await saveGasto(gastoParaSalvar);
            
            // CORRIGIDO: A propriedade correta é 'rowId', não 'id'.
            const confirmSections = [{
              title: "Próximos Passos",
              rows: [
                { rowId: 'id_excluir_gasto_list', title: '🗑️ Excluir Último Gasto', description: 'Remover o gasto que acabei de registrar' },
                { rowId: 'id_historico_list', title: '📜 Ver Histórico', description: 'Consultar meus gastos anteriores' },
                { rowId: 'id_relatorio_list', title: '📊 Acessar Relatório Web', description: 'Ver gráficos e estatísticas' }
              ]
            }];

            const confirmListMessage = {
              text: `✅ *Gasto Registrado!*\n\n💰 Valor: R$ ${parseFloat(valor).toFixed(2)}\n📂 Categoria: ${categoria}\n\nO que você gostaria de fazer a seguir?`,
              footer: 'Escolha uma opção na lista:',
              title: "Ações do Gasto",
              buttonText: "Ver Ações",
              sections: confirmSections
            };
            // Para enviar uma lista, o objeto deve estar dentro de uma chave 'listMessage'
            await botSocket.sendMessage(sender, confirmListMessage);

          } else {
            await botSocket.sendMessage(sender, { text: `Entendi que você quer registrar um gasto, mas preciso do *valor* e da *categoria*. Ex: "Gastei 50 no almoço".` });
          }
          break;
        }

        case 'ver_historico': {
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
          await botSocket.sendMessage(sender, { text: mensagemHistorico });
          break;
        }
        
        // Unificado para evitar duplicação de lógica
        case 'ver_relatorio_web':
        case 'obter_codigo_acesso': {
            const accessCode = generateAccessCode(sender);
            const BASE_RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
            const webUrl = BASE_RAILWAY_URL ? `https://${BASE_RAILWAY_URL}` : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
            
            const responseText = `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${accessCode}*\n\nAcesse: ${webUrl}\n\n⏰ Este código expira em 10 minutos.`;
            await botSocket.sendMessage(sender, { text: responseText });
            break;
        }

        case 'excluir_gasto': {
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

        case 'saudacao': {
          await botSocket.sendMessage(sender, { text: "👋 Olá! Eu sou o PoquidaGrana, seu assistente financeiro. Como posso te ajudar hoje?" });
          break;
        }

        case 'agradecimento': {
          await botSocket.sendMessage(sender, { text: "De nada! Fico feliz em ajudar com suas finanças." });
          break;
        }

        case 'ajuda':
        case 'outro':
        default: {
          console.log("⚠️ Intenção não reconhecida ou comando de ajuda. Oferecendo menu.");
          
          // CORRIGIDO: A propriedade correta é 'rowId', não 'id'.
          const helpSections = [{
            title: "Opções Rápidas",
            rows: [
              { rowId: 'id_historico_list', title: "📜 Ver Histórico", description: "Veja seus últimos gastos" },
              { rowId: 'id_relatorio_list', title: "📊 Acessar Relatório Web", description: "Gera um código para o painel de controle" },
              { rowId: 'id_excluir_gasto_list', title: '🗑️ Excluir Último Gasto', description: 'Remover o gasto mais recente' }
            ],
          }];

          const helpListMessage = {
            text: `❓ *Não entendi muito bem. Você pode me dizer o que gostaria de fazer (ex: "Gastei 15 no almoço") ou escolher uma opção:*\n`,
            footer: 'Escolha uma opção na lista:',
            title: "Ajuda e Comandos",
            buttonText: "Ver Opções",
            sections: helpSections,
          };
          await botSocket.sendMessage(sender, helpListMessage);
          break;
        }
      }
    } catch (error) {
        console.error("🚨 CRITICAL ERROR in message processing: ", error);
        await botSocket.sendMessage(sender, { text: "🤖 Ops! Ocorreu um erro interno e não consegui processar sua solicitação. A equipe técnica já foi notificada. Por favor, tente novamente." });
    }
  });
}

const webApp = require('./web-server');

const PORT = process.env.PORT || 3000;

webApp.get("/", (req, res) => res.send("🤖 PoquidaGrana rodando"));
webApp.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));

connectToWhatsApp();