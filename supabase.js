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
  const { error } = await supabase.from("gastos").insert(gastoData);

  if (error) {
    console.error("❌ Erro ao salvar no Supabase:", error.message);
  } else {
    console.log("✅ Gasto salvo com sucesso no Supabase!");
  }
}

/**
 * Busca todos os gastos de um usuário específico, ordenados do mais recente para o mais antigo.
 */
async function getGastosByUser(userJid) {
  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .eq("usuario_id", userJid)
    .order("criado_em", { ascending: false });

  if (error) {
    console.error("❌ Erro ao buscar gastos:", error.message);
    return [];
  }

  return data || [];
}

/**
 * Atualiza um gasto existente no banco de dados.
 * @param {string} gastoId - O ID (UUID) do gasto a ser atualizado.
 * @param {object} updates - Um objeto contendo os campos a serem atualizados (ex: { valor: 100, categoria: "nova" }).
 */
async function updateGasto(gastoId, updates) {
  const { data, error } = await supabase
    .from("gastos")
    .update(updates)
    .eq("id", gastoId)
    .select();

  if (error) {
    console.error("❌ Erro ao atualizar gasto no Supabase:", error.message);
    return { success: false, error: error.message };
  } else {
    console.log(`✅ Gasto ${gastoId} atualizado com sucesso!`);
    return { success: true, data: data[0] };
  }
}

/**
 * Deleta um gasto existente no banco de dados.
 * @param {string} gastoId - O ID (UUID) do gasto a ser deletado.
 */
async function deleteGasto(gastoId) {
  const { error } = await supabase
    .from("gastos")
    .delete()
    .eq("id", gastoId);

  if (error) {
    console.error("❌ Erro ao deletar gasto no Supabase:", error.message);
    return { success: false, error: error.message };
  } else {
    console.log(`🗑️ Gasto ${gastoId} deletado com sucesso!`);
    return { success: true };
  }
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
    const mes = new Date(gasto.criado_em).toLocaleDateString('pt-BR', {
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

/**
 * Encontra um usuário pelo JID do WhatsApp ou o cria se não existir.
 * @param {string} whatsappJid - O JID do WhatsApp do usuário.
 * @param {string} [nome=null] - O nome do usuário (opcional).
 * @returns {Promise<object|null>} Os dados do usuário ou null em caso de erro.
 */
async function findOrCreateUser(whatsappJid, nome = null) {
    try {
        let { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('whatsapp', whatsappJid)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error("❌ Erro ao buscar usuário no Supabase:", error.message);
            return null;
        }

        if (usuario) {
            console.log(`✅ Usuário existente encontrado: ${usuario.whatsapp}`);
            return usuario;
        } else {
            console.log(`➕ Criando novo usuário: ${whatsappJid}`);
            const { data: novoUsuario, error: createError } = await supabase
                .from('usuarios')
                .insert({ whatsapp: whatsappJid, nome: nome })
                .select('*')
                .single();

            if (createError) {
                console.error("❌ Erro ao criar novo usuário no Supabase:", createError.message);
                return null;
            }
            console.log(`✅ Novo usuário criado com sucesso: ${novoUsuario.whatsapp}`);
            return novoUsuario;
        }
    } catch (e) {
        console.error("❌ Erro inesperado em findOrCreateUser:", e.message);
        return null;
    }
}


// Exporta as funções
module.exports = { saveGasto, getGastosByUser, getGastosStats, findOrCreateUser, updateGasto, deleteGasto }; // Exporta deleteGasto