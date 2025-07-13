const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Inicializa o cliente do Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Salva um novo registro de gasto no banco de dados.
 * @param {object} gastoData - Um objeto contendo os dados do gasto.
 * @param {string} gastoData.usuario_id - O ID do usuário que fez o gasto (neste caso, o JID do WhatsApp).
 * @param {number} gastoData.valor - O valor do gasto.
 * @param {string} gastoData.categoria - A categoria do gasto.
 * @param {string} gastoData.descricao - A mensagem original que gerou o registro.
 */
async function saveGasto(gastoData) {
  // O 'id' não é enviado, pois o banco de dados o cria automaticamente
  const { error } = await supabase.from("gastos").insert(gastoData);

  if (error) {
    console.error("❌ Erro ao salvar no Supabase:", error.message);
    // Para depuração mais detalhada, você pode logar o erro completo:
    // console.error(error); 
  } else {
    console.log("✅ Gasto salvo com sucesso no Supabase!");
  }
}

// Exporta a função para que o index.js possa usá-la
module.exports = { saveGasto };
