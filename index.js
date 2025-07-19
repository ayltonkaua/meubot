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
const { getAIIntent } = require("./groq-service"); // NOVO: Importa o serviço da Groq

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
    // O Groq fará a normalização, então podemos enviar o texto original ou a versão processada
    // text = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 

    console.log(`📩 Processando: "${text}" de ${sender}`);

    const usuario = await findOrCreateUser(sender);
    if (!usuario) {
        console.log(`❌ Não foi possível encontrar ou criar o usuário ${sender}. Abortando processamento.`);
        await botSocket.sendMessage(sender, { text: "⚠️ Ocorreu um erro ao identificar seu usuário. Por favor, tente novamente mais tarde." });
        return;
    }

    // --- NOVO: Lógica principal com a API da Groq ---
    let intent = 'outro';
    let entities = {};

    // Prioriza clique em lista, depois a IA
    if (msg.message.listResponseMessage) {
        const selectedRowId = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
        console.log(`Item de lista clicado: ${selectedRowId}`);
        // Mapeie os IDs da lista para intenções e entidades para reuso da lógica abaixo
        switch (selectedRowId) {
            case 'id_historico_list': intent = 'ver_historico'; break;
            case 'id_relatorio_list': intent = 'ver_relatorio_web'; break;
            case 'id_excluir_gasto_list': intent = 'excluir_gasto'; break;
            // Para a ajuda, talvez chame uma intenção 'ajuda'
            case 'id_ajuda_list': intent = 'ajuda'; break; 
            default: intent = 'outro'; break;
        }
        // Se a interação veio de um botão, não precisamos da Groq para essa intenção
    } else {
        // Se não for um clique em lista, chama a Groq API
        const groqResponse = await getAIIntent(text);
        intent = groqResponse.intent;
        entities = groqResponse.entities;
        console.log(`Groq AI - Intenção: ${intent}, Entidades: ${JSON.stringify(entities)}`);
    }

    switch (intent) {
        case 'registrar_gasto': {
            const valor = entities.valor;
            // Se a Groq não forneceu a categoria, tente detectar com seu classificador existente
            const categoria = entities.categoria || detectarCategoria(text); 
            const descricao = entities.descricao || text; // Use a descrição da Groq ou a mensagem original

            if (valor && categoria) {
                const gastoParaSalvar = {
                    usuario_id: sender,
                    valor: parseFloat(valor), // Garante que é um número
                    categoria: categoria,
                    descricao: descricao,
                };
                await saveGasto(gastoParaSalvar);

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
                    text: `✅ *Gasto Registrado!*\n\n💰 Valor: R$ ${parseFloat(valor).toFixed(2)}\n📂 Categoria: ${categoria}\n\nO que você gostaria de fazer a seguir?`,
                    footer: 'Escolha uma opção na lista:',
                    title: "Ações do Gasto",
                    buttonText: "Ver Ações",
                    sections: confirmSections
                };
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
            mensagemHistorico += `\n\nPara ver o relatório completo: */codigo*`;
            await botSocket.sendMessage(sender, { text: mensagemHistorico });
            break;
        }

        case 'ver_relatorio_web':
        case 'obter_codigo_acesso': { // Unifica a lógica para acessar o painel
            const accessCode = generateAccessCode(sender);
            const BASE_RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
            const webUrl = BASE_RAILWAY_URL ? `https://${BASE_RAILWAY_URL}` : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
            
            let responseText;
            if (intent === 'ver_relatorio_web') {
                responseText = `📊 *Acesse seu relatório completo*\n\nPara ver gráficos e estatísticas detalhadas, digite: */codigo*\n\nOu acesse diretamente: ${webUrl}`;
            } else { // obter_codigo_acesso
                responseText = `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${accessCode}*\n\nAcesse: ${webUrl}\n\n⏰ Este código expira em 10 minutos.`;
            }
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
        case 'outro': // Se a IA não entender, ou for uma intenção 'ajuda' explícita
        default: {
            console.log("⚠️ Intenção não reconhecida ou comando de ajuda. Oferecendo menu.");
            const helpSections = [
              {
                title: "Opções Rápidas",
                rows: [
                  { id: 'id_historico_list', title: "📜 Ver Histórico", description: "Veja seus últimos gastos" },
                  { id: 'id_relatorio_list', title: "📊 Acessar Relatório Web", description: "Abra o painel de controle" },
                  { id: 'id_excluir_gasto_list', title: '🗑️ Excluir Último Gasto', description: 'Remover o gasto mais recente' }
                ],
              },
            ];

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
  });
}

const webApp = require('./web-server'); 

const PORT = process.env.PORT || 3000; 

webApp.get("/", (req, res) => res.send("🤖 PoquidaGrana rodando"));
webApp.listen(PORT, () => console.log(`🌐 Servidor web rodando na porta ${PORT}`));

connectToWhatsApp();