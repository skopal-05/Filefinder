const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { createEmbedding, rankSearchResults } = require("./semanticSearch");
const { rankPartialMatches, validatePartialSearchRequest } = require("./partialSearch");
const {
  getUserIdentity,
  jsonResponse,
  normalizeItem,
  optionsResponse
} = require("./shared");

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { OWNER_INDEX_NAME, S3_BUCKET_NAME, DYNAMODB_TABLE, OPENAI_API_KEY } = process.env;
const DEFAULT_CANDIDATE_LIMIT = Number(process.env.PARTIAL_SEARCH_CANDIDATES || 200);

const loadUserItems = async (ownerSub) => {
  if (OWNER_INDEX_NAME) {
    try {
      return await dynamoClient.send(
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

  return dynamoClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "ownerSub = :ownerSub",
      ExpressionAttributeValues: {
        ":ownerSub": ownerSub
      }
    })
  );
};

const withDownloadUrl = async (item) => {
  const downloadUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: item.s3Key
    }),
    { expiresIn: 300 }
  );

  return {
    ...normalizeItem(item),
    downloadUrl
  };
};

const matchesFilters = (item, { fileType, dateFrom, dateTo }) => {
  const contentType = String(item.contentType || "").toLowerCase();
  const filename = String(item.originalFilename || item.displayName || "").toLowerCase();
  const uploadedAt = String(item.uploadedAt || "");

  if (fileType && ![contentType, filename].some((value) => value.includes(fileType))) {
    return false;
  }

  if (dateFrom && uploadedAt < dateFrom) {
    return false;
  }

  if (dateTo && uploadedAt > dateTo) {
    return false;
  }

  return true;
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return optionsResponse("OPTIONS,POST", event);
  }

  if (!S3_BUCKET_NAME || !DYNAMODB_TABLE) {
    return jsonResponse(
      500,
      { message: "Missing required environment variables." },
      "OPTIONS,POST",
      event
    );
  }

  try {
    const identity = getUserIdentity(event);
    const { query, fileType, dateFrom, dateTo, limit } = validatePartialSearchRequest(event);
    const result = await loadUserItems(identity.ownerSub);
    const filteredItems = (result.Items || []).filter((item) =>
      matchesFilters(item, { fileType, dateFrom, dateTo })
    );

    let rankedItems = rankPartialMatches({
      items: filteredItems,
      query,
      limit
    });

    if (rankedItems.length === 0 && OPENAI_API_KEY) {
      const hasEmbeddings = filteredItems.some(
        (item) => Array.isArray(item.embeddingVector) && item.embeddingVector.length > 0
      );

      if (hasEmbeddings) {
        try {
          const queryEmbedding = await createEmbedding(query);
          rankedItems = rankSearchResults({
            items: filteredItems,
            query,
            queryEmbedding
          }).slice(0, limit);
        } catch (error) {
          console.error("partialSearchLambda semantic fallback failed", error);
        }
      }
    }

    const files = await Promise.all(rankedItems.map(withDownloadUrl));

    return jsonResponse(
      200,
      {
        files,
        totalCandidates: filteredItems.length
      },
      "OPTIONS,POST",
      event
    );
  } catch (error) {
    console.error("partialSearchLambda failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        message:
          error.statusCode === 401
            ? "Authentication required."
            : "Failed to perform partial search.",
        error: error.message
      },
      "OPTIONS,POST",
      event
    );
  }
};
