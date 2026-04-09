const { buildEmbeddingInput, getEmbedding } = require("./services/embeddingService");
const cosineSimilarity = require("./utils/cosineSimilarity");
const { normalizeSearchText } = require("./shared");

const keywordScore = (query, item) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const compactQuery = normalizeSearchText(query);

  if (!normalizedQuery && !compactQuery) {
    return 0;
  }

  const haystack = [
    item.displayName || item.file_name,
    item.originalFilename || item.original_filename,
    item.description,
    item.contentType || item.content_type,
    ...(Array.isArray(item.tags) ? item.tags : [])
  ]
    .join(" ")
    .toLowerCase();

  const compactHaystack = normalizeSearchText(haystack);

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    return 1;
  }

  return compactQuery && compactHaystack.includes(compactQuery) ? 1 : 0;
};

const rankSearchResults = ({ items, query, queryEmbedding }) =>
  items
    .map((item) => ({
      ...item,
      searchScore: cosineSimilarity(
        queryEmbedding,
        item.embeddingVector || item.embedding_vector || []
      ),
      searchStrategy: "semantic"
    }))
    .sort((left, right) => right.searchScore - left.searchScore);

module.exports = {
  buildEmbeddingText: ({ displayName = "", tags = [], description = "" }) =>
    buildEmbeddingInput({
      fileName: displayName,
      tags,
      description
    }),
  cosineSimilarity,
  createEmbedding: getEmbedding,
  keywordScore,
  rankSearchResults
};
