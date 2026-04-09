const OpenAI = require("openai");
const { createHttpError } = require("../shared");

const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_DIMENSIONS = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 0);

let openaiClient;

const getOpenAIClient = () => {
  if (!OPENAI_API_KEY) {
    throw createHttpError(500, "OPENAI_API_KEY is not configured.");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: OPENAI_API_KEY
    });
  }

  return openaiClient;
};

const buildEmbeddingInput = ({ fileName = "", tags = [], description = "" }) =>
  [
    `file_name: ${String(fileName || "").trim()}`,
    `tags: ${Array.isArray(tags) ? tags.join(", ") : ""}`,
    `description: ${String(description || "").trim()}`
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

const getEmbedding = async (text) => {
  const input = String(text || "").trim();

  if (!input) {
    throw createHttpError(400, "Embedding input cannot be empty.");
  }

  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input,
    ...(OPENAI_EMBEDDING_DIMENSIONS > 0 ? { dimensions: OPENAI_EMBEDDING_DIMENSIONS } : {})
  });

  const vector = response.data?.[0]?.embedding;

  if (!Array.isArray(vector) || vector.length === 0) {
    throw createHttpError(502, "Embedding response did not include a vector.");
  }

  return vector;
};

module.exports = {
  buildEmbeddingInput,
  getEmbedding
};
