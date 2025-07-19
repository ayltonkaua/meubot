// groq-service.js
const Groq = require("groq-sdk");
require("dotenv").config(); // Garante que as variáveis de ambiente sejam carregadas

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Envia uma mensagem para a API da Groq para identificar a intenção e extrair entidades.
 * @param {string} userMessage - A mensagem original do usuário.
 * @returns {Promise<{intent: string, entities: object}>} Um objeto contendo a intenção detectada e as entidades extraídas.
 */
async function getAIIntent(userMessage) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Você é um assistente financeiro no WhatsApp. Sua tarefa é analisar a mensagem do usuário, identificar a intenção principal e extrair dados relevantes em formato JSON.

As intenções possíveis são:
- 'registrar_gasto': quando o usuário quer registrar uma despesa.
- 'ver_historico': quando o usuário quer ver seus gastos anteriores.
- 'ver_relatorio_web': quando o usuário quer acessar o painel web ou relatórios.
- 'obter_codigo_acesso': quando o usuário solicita o código de acesso ao painel web.
- 'excluir_gasto': quando o usuário quer remover uma despesa.
- 'saudacao': quando o usuário inicia a conversa ou cumprimenta (ex: "oi", "ola", "bom dia").
- 'agradecimento': quando o usuário agradece (ex: "obrigado", "valeu").
- 'ajuda': quando o usuário pede ajuda ou não entende (ex: "ajuda", "como usar", "o que você faz").
- 'outro': para qualquer outra intenção não listada.

Para 'registrar_gasto', tente extrair as seguintes entidades:
- 'valor': o valor numérico da despesa (usar ponto como separador decimal).
- 'categoria': a categoria do gasto (ex: "alimentacao", "transporte", "lazer", "contas", "saude", "educacao", "casa", "vestuario", "servicos", "presentes", "financas"). Se não puder determinar, use 'outros'.
- 'descricao': a descrição textual do gasto.

Exemplos de saída JSON:
- Se "Gastei 50 no almoço": { "intent": "registrar_gasto", "entities": { "valor": 50, "categoria": "alimentacao", "descricao": "gastei 50 no almoço" } }
- Se "Minhas despesas": { "intent": "ver_historico", "entities": {} }
- Se "Quero acessar o painel": { "intent": "obter_codigo_acesso", "entities": {} }
- Se "Obrigado": { "intent": "agradecimento", "entities": {} }
- Se "Apagar ultimo gasto": { "intent": "excluir_gasto", "entities": {} }
- Se "Bom dia": { "intent": "saudacao", "entities": {} }

A saída deve ser *apenas* o objeto JSON. Não inclua texto explicativo antes ou depois do JSON. Se a Groq não conseguir determinar uma entidade, ela pode ser omitida ou definida como null/undefined.
`
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            model: "llama3-8b-8192", // Use o modelo de sua preferência, este é um bom ponto de partida
            temperature: 0.2, // Um valor baixo para respostas mais diretas
            response_format: { type: "json_object" } // Essencial para receber JSON
        });

        const jsonResponse = JSON.parse(chatCompletion.choices[0].message.content);
        return {
            intent: jsonResponse.intent || 'outro',
            entities: jsonResponse.entities || {}
        };

    } catch (error) {
        console.error("❌ Erro ao chamar Groq API:", error.message);
        return { intent: 'outro', entities: {} }; // Fallback em caso de erro na API
    }
}

module.exports = { getAIIntent };