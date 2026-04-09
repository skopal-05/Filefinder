const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  getUserIdentity,
  jsonResponse,
  optionsResponse,
  parseBody,
  createHttpError
} = require("../shared");
const { semanticSearch } = require("../services/searchService");

const s3Client = new S3Client({});
const { S3_BUCKET_NAME } = process.env;

const parseSearchInput = (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  const source = method === "GET" ? event.queryStringParameters || {} : parseBody(event);
  const query = String(source.query || "").trim();
  const fileType = String(source.fileType || "").trim();
  const date = String(source.date || source.dateFrom || "").trim();
  const limit = Math.min(Math.max(Number(source.limit || 10), 1), 25);

  if (!query) {
    throw createHttpError(400, "query is required.");
  }

  return {
    query,
    fileType,
    date,
    limit
  };
};

const mapResult = (item) => ({
  file_id: item.file_id,
  file_name: item.file_name,
  score: Number(item.score.toFixed(4))
});

const withDownloadUrl = async (item) => {
  const downloadUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: item.s3_key
    }),
    { expiresIn: 300 }
  );

  return {
    fileId: item.file_id,
    displayName: item.file_name,
    originalFilename: item.original_filename,
    s3Key: item.s3_key,
    contentType: item.content_type,
    uploadedAt: item.uploaded_at,
    size: item.size,
    score: Number(item.score.toFixed(4)),
    downloadUrl
  };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return optionsResponse("OPTIONS,GET,POST", event);
  }

  if (!S3_BUCKET_NAME) {
    return jsonResponse(
      500,
      {
        success: false,
        message: "Missing required environment variables."
      },
      "OPTIONS,GET,POST",
      event
    );
  }

  try {
    const identity = getUserIdentity(event);
    const { query, fileType, date, limit } = parseSearchInput(event);
    const results = await semanticSearch({
      ownerSub: identity.ownerSub,
      query,
      fileType,
      date,
      limit
    });
    const files = await Promise.all(results.map(withDownloadUrl));

    return jsonResponse(
      200,
      {
        success: true,
        results: results.map(mapResult),
        files
      },
      "OPTIONS,GET,POST",
      event
    );
  } catch (error) {
    console.error("searchHandler failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        success: false,
        message: error.statusCode === 401 ? "Authentication required." : "Failed to search files.",
        error: error.message
      },
      "OPTIONS,GET,POST",
      event
    );
  }
};
