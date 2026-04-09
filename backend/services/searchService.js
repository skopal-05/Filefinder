const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const cosineSimilarity = require("../utils/cosineSimilarity");
const { getEmbedding } = require("./embeddingService");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_CANDIDATE_LIMIT = Number(process.env.SEMANTIC_SEARCH_CANDIDATES || 200);
const FALLBACK_THRESHOLD = Number(process.env.SEMANTIC_SEARCH_THRESHOLD || 0.5);
const STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "file",
  "files",
  "find",
  "for",
  "me",
  "my",
  "of",
  "related",
  "search",
  "show",
  "the",
  "to"
]);

const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const extractSearchTerms = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));

const normalizeFileRecord = (item) => ({
  file_id: item.file_id || item.fileId || item.filename,
  file_name: item.file_name || item.fileName || item.displayName || item.originalFilename || item.filename,
  original_filename: item.originalFilename || item.original_file_name || item.file_name || item.fileName || item.displayName || item.filename,
  tags: Array.isArray(item.tags) ? item.tags : [],
  description: item.description || "",
  s3_key: item.s3_key || item.s3Key || "",
  is_deleted: Boolean(item.is_deleted || item.isDeleted),
  embedding_vector: item.embedding_vector || item.embeddingVector || [],
  content_type: item.content_type || item.contentType || "application/octet-stream",
  uploaded_at: item.uploaded_at || item.uploadedAt || "",
  size: item.size || 0
});

const matchesFilters = (item, { fileType, date }) => {
  const normalizedType = String(fileType || "").trim().toLowerCase();
  const normalizedDate = String(date || "").trim();

  if (normalizedType) {
    const typeSource = [item.content_type, item.file_name].join(" ").toLowerCase();

    if (!typeSource.includes(normalizedType)) {
      return false;
    }
  }

  if (normalizedDate && item.uploaded_at) {
    const itemDate = String(item.uploaded_at).slice(0, 10);

    if (itemDate !== normalizedDate) {
      return false;
    }
  }

  return !item.is_deleted;
};

const loadCandidateFiles = async ({ ownerSub, fileType, date }) => {
  const { DYNAMODB_TABLE, OWNER_INDEX_NAME } = process.env;

  if (!DYNAMODB_TABLE) {
    throw new Error("DYNAMODB_TABLE is not configured.");
  }

  let result;

  if (OWNER_INDEX_NAME && ownerSub) {
    try {
      result = await dynamoClient.send(
        new QueryCommand({
          TableName: DYNAMODB_TABLE,
          IndexName: OWNER_INDEX_NAME,
          KeyConditionExpression: "ownerSub = :ownerSub",
          ExpressionAttributeValues: {
            ":ownerSub": ownerSub
          },
          ScanIndexForward: false,
          Limit: DEFAULT_CANDIDATE_LIMIT
        })
      );
    } catch (error) {
      if (error.name !== "ValidationException" && error.name !== "ResourceNotFoundException") {
        throw error;
      }
    }
  }

  if (!result) {
    result = await dynamoClient.send(
      new ScanCommand({
        TableName: DYNAMODB_TABLE,
        FilterExpression: "ownerSub = :ownerSub",
        ExpressionAttributeValues: {
          ":ownerSub": ownerSub
        }
      })
    );
  }

  return (result.Items || [])
    .map(normalizeFileRecord)
    .filter((item) => matchesFilters(item, { fileType, date }));
};

const rankKeywordResults = (items, query, limit) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const compactQuery = normalizeSearchText(query);
  const terms = extractSearchTerms(query);

  return items
    .map((item) => ({
      ...item,
      score: (() => {
        const haystack = [item.file_name, item.description, ...(Array.isArray(item.tags) ? item.tags : [])]
          .join(" ")
          .toLowerCase();
        const compactHaystack = normalizeSearchText(haystack);
        let score = 0;

        if (normalizedQuery && haystack.includes(normalizedQuery)) {
          score += 2;
        }

        for (const term of terms) {
          if (haystack.includes(term)) {
            score += 1;
          }
        }

        if (compactQuery && compactHaystack.includes(compactQuery)) {
          score += 1.5;
        }

        return score;
      })()
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};

const semanticSearch = async ({ ownerSub, query, fileType, date, limit = DEFAULT_LIMIT }) => {
  const normalizedLimit = Math.min(Math.max(Number(limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const candidates = await loadCandidateFiles({ ownerSub, fileType, date });

  if (!candidates.length) {
    return [];
  }

  const queryEmbedding = await getEmbedding(query);
  const scored = candidates
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding_vector)
    }))
    .sort((left, right) => right.score - left.score);

  if (!scored.length || scored[0].score < FALLBACK_THRESHOLD) {
    return rankKeywordResults(candidates, query, normalizedLimit);
  }

  return scored.slice(0, normalizedLimit);
};

module.exports = {
  loadCandidateFiles,
  normalizeFileRecord,
  semanticSearch
};
