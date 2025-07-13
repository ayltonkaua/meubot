function detectarCategoria(texto) {
  const categorias = {
    alimentação: ["comida", "lanche", "mercado", "supermercado", "pizza", "refeição"],
    transporte: ["uber", "ônibus", "gasolina", "combustível", "corrida", "transporte"],
    lazer: ["cinema", "show", "passeio", "lazer", "diversão"],
    contas: ["luz", "água", "internet", "telefone", "conta"],
    saúde: ["remédio", "consulta", "médico", "hospital", "farmácia"],
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
