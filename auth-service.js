
const crypto = require('crypto');

// Armazena códigos temporários em memória (em produção, use Redis ou banco)
const accessCodes = new Map();

// Referência ao socket do bot (será definida pelo index.js)
let botSocket = null;

function setBotSocket(socket) {
  botSocket = socket;
  console.log('✅ Socket do bot definido no auth-service');
}

async function sendCodeViaWhatsApp(jid, code) {
  if (!botSocket) {
    throw new Error('Bot do WhatsApp não está conectado');
  }
  
  try {
    await botSocket.sendMessage(jid, {
      text: `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${code}*\n\n⏰ Este código expira em 10 minutos.\n\n💻 Digite este código no site para acessar seus registros.`,
    });
    console.log(`✅ Código ${code} enviado via WhatsApp para ${jid}`);
    return true;
  } catch (error) {
    console.error('❌ Erro ao enviar código via WhatsApp:', error);
    throw error;
  }
}

function generateAccessCode(userJid) {
  // Gera código de 6 dígitos
  const code = Math.random().toString().slice(2, 8);
  
  // Armazena com expiração de 10 minutos
  accessCodes.set(userJid, {
    code,
    expires: Date.now() + (10 * 60 * 1000)
  });
  
  console.log(`🔑 Código gerado para ${userJid}: ${code}`);
  return code;
}

function verifyAccessCode(userJid, inputCode) {
  const stored = accessCodes.get(userJid);
  
  if (!stored) {
    return false;
  }
  
  if (Date.now() > stored.expires) {
    accessCodes.delete(userJid);
    return false;
  }
  
  if (stored.code === inputCode) {
    accessCodes.delete(userJid);
    return true;
  }
  
  return false;
}

module.exports = { generateAccessCode, verifyAccessCode, setBotSocket, sendCodeViaWhatsApp };
