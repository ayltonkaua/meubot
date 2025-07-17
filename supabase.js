const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Inicializa o cliente do Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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

/**
 * Busca todos os gastos de um usuário específico
 */
async function getGastosByUser(userJid) {
  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .eq("usuario_id", userJid)
    .order("data_criacao", { ascending: false });

  if (error) {
    console.error("❌ Erro ao buscar gastos:", error.message);
    return [];
  }

  return data || [];
}

/**
 * Gera estatísticas dos gastos do usuário
 */
async function getGastosStats(userJid) {
  const gastos = await getGastosByUser(userJid);
  
  if (gastos.length === 0) {
    return {
      total: 0,
      totalGastos: 0,
      categorias: {},
      gastosPorMes: {},
      maiorGasto: null,
      menorGasto: null
    };
  }

  const total = gastos.reduce((sum, gasto) => sum + parseFloat(gasto.valor), 0);
  const categorias = {};
  const gastosPorMes = {};
  
  gastos.forEach(gasto => {
    // Estatísticas por categoria
    if (!categorias[gasto.categoria]) {
      categorias[gasto.categoria] = { total: 0, count: 0 };
    }
    categorias[gasto.categoria].total += parseFloat(gasto.valor);
    categorias[gasto.categoria].count++;
    
    // Estatísticas por mês
    const mes = new Date(gasto.data_criacao).toLocaleDateString('pt-BR', { 
      year: 'numeric', 
      month: 'long' 
    });
    if (!gastosPorMes[mes]) {
      gastosPorMes[mes] = 0;
    }
    gastosPorMes[mes] += parseFloat(gasto.valor);
  });

  const valores = gastos.map(g => parseFloat(g.valor));
  
  return {
    total: total.toFixed(2),
    totalGastos: gastos.length,
    categorias,
    gastosPorMes,
    maiorGasto: Math.max(...valores).toFixed(2),
    menorGasto: Math.min(...valores).toFixed(2),
    mediaGasto: (total / gastos.length).toFixed(2)
  };
}

// Exporta as funções
module.exports = { saveGasto, getGastosByUser, getGastosStats };
