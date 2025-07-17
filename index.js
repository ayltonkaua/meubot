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

// Criar pasta auth se não existir
if (!fs.existsSync("./auth")) {
  fs.mkdirSync("./auth");
}

let botSocket = null;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  console.log(`📦 Baileys v${version.join(".")} iniciado`);

  botSocket = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    version,
    getMessage: async () => undefined,
  });

  botSocket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📸 Escaneie o QR code abaixo no WhatsApp:");
      console.log(qr); // Cole esse QR no site https://www.qr-code-generator.com/
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error instanceof Boom &&
        lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Conexão encerrada");
      console.log("➡️ Tentando reconectar:", shouldReconnect);

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      }
    }

    if (connection === "open") {
      console.log("✅ Bot conectado com sucesso!");
      console.log(`👤 Usuário: ${botSocket.user?.name}`);
      console.log(`📱 Número: ${botSocket.user?.id}`);
    }
  });

  botSocket.ev.on("creds.update", saveCreds);
}

connectToWhatsApp();
