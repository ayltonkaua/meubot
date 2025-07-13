
const crypto = require('crypto');

// Armazena códigos temporários em memória (em produção, use Redis ou banco)
const accessCodes = new Map();

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

module.exports = { generateAccessCode, verifyAccessCode };
