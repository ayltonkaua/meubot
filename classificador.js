function detectarCategoria(texto) {
 const categorias = {
    alimentação: [
      "comida", "lanche", "mercado", "supermercado", "pizza", "refeição",
      "restaurante", "bar", "cafe", "padaria", "doce", "bebida", "jantar", "almoço", "café da manhã"
    ],
    transporte: [
      "uber", "99", "99 pop", "ônibus", "gasolina", "combustível", "corrida", "transporte",
      "metrô", "táxi", "carro", "manutenção carro", "pedágio", "estacionamento", "passagem"
    ],
    lazer: [
      "cinema", "show", "passeio", "lazer", "diversão", "teatro", "concerto",
      "viagem", "hotel", "passagens", "balada", "festa", "parque", "jogos", "esporte", "hobby"
    ],
    contas: [
      "luz", "água", "internet", "telefone", "conta", "aluguel", "condomínio",
      "iptu", "ipva", "imposto", "boleto", "gás", "tv"
    ],
    saúde: [
      "remédio", "consulta", "médico", "hospital", "farmácia", "dentista",
      "terapia", "exame", "plano de saúde", "vacina", "clínica"
    ],
    educação: [
      "curso", "faculdade", "escola", "livro", "material escolar", "mensalidade",
      "treinamento", "workshop", "educação"
    ],
    casa: [
      "manutenção casa", "reforma", "limpeza", "material construção", "móveis",
      "decoração", "eletrodoméstico", "jardim", "faxina"
    ],
    vestuário: [
      "roupa", "sapato", "acessório", "moda", "loja de roupa", "alfaiataria"
    ],
    serviços: [
      "cabelo", "barbeiro", "salão", "estética", "lavanderia", "assinatura",
      "streaming", "academia", "software", "nuvem"
    ],
    presentes: [
      "presente", "doação", "caridade", "flor", "aniversário"
    ],
    finanças: [
      "investimento", "juros", "taxa", "banco", "empréstimo", "seguro"
    ],
    outros: []
  };

  texto = texto.toLowerCase();
  for (const categoria in categorias) {
    if (categorias[categoria].some(palavra => texto.includes(palavra))) {
      return categoria;
    }
  }
  return "outros";
}

module.exports = { detectarCategoria };
