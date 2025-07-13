
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
  console.log(`📤 Tentando enviar código via WhatsApp...`);
  console.log(`   Socket disponível: ${!!botSocket}`);
  console.log(`   JID completo: ${jid}`);
  console.log(`   Número extraído: ${jid.replace('@s.whatsapp.net', '')}`);
  console.log(`   Código: ${code}`);
  
  if (!botSocket) {
    console.error('❌ Bot do WhatsApp não está conectado');
    throw new Error('Bot do WhatsApp não está conectado');
  }
  
  // Verificar se o socket está conectado
  if (!botSocket.user) {
    console.error('❌ Socket não está autenticado');
    throw new Error('Socket não está autenticado');
  }
  
  try {
    console.log(`🚀 Enviando mensagem...`);
    
    // Verificar se o JID existe nos contatos do bot
    const exists = await botSocket.onWhatsApp(jid);
    console.log(`📱 Verificação do número: ${exists.length > 0 ? 'Número válido' : 'Número não encontrado'}`);
    
    if (exists.length === 0) {
      console.error(`❌ Número ${jid} não encontrado no WhatsApp`);
      throw new Error('Número não encontrado no WhatsApp');
    }
    
    // Tentar enviar a mensagem com retry
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`🔄 Tentativa ${attempts}/${maxAttempts} de envio...`);
        
        const result = await botSocket.sendMessage(jid, {
          text: `🔐 *Código de Acesso ao Sistema Web*\n\nSeu código: *${code}*\n\n⏰ Este código expira em 10 minutos.\n\n💻 Digite este código no site para acessar seus registros.`,
        });
        
        console.log(`✅ Mensagem enviada com sucesso:`, result.key.id);
        console.log(`✅ Código ${code} enviado via WhatsApp para ${jid}`);
        return true;
        
      } catch (sendError) {
        console.error(`❌ Erro na tentativa ${attempts}:`, sendError.message);
        
        if (attempts < maxAttempts) {
          console.log(`⏳ Aguardando 2 segundos antes da próxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw sendError;
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Erro detalhado ao enviar código:', error);
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
  console.log(`🔍 Verificando código no auth-service:`);
  console.log(`   JID: ${userJid}`);
  console.log(`   Código digitado: ${inputCode}`);
  
  const stored = accessCodes.get(userJid);
  console.log(`   Código armazenado:`, stored);
  
  if (!stored) {
    console.log(`   ❌ Nenhum código encontrado para este JID`);
    return false;
  }
  
  if (Date.now() > stored.expires) {
    console.log(`   ❌ Código expirado`);
    accessCodes.delete(userJid);
    return false;
  }
  
  if (stored.code === inputCode) {
    console.log(`   ✅ Código válido!`);
    accessCodes.delete(userJid);
    return true;
  }
  
  console.log(`   ❌ Código não confere`);
  return false;
}

module.exports = { generateAccessCode, verifyAccessCode, setBotSocket, sendCodeViaWhatsApp };
