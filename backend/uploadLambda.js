const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { buildEmbeddingInput, getEmbedding } = require("./services/embeddingService");
const {
  buildRecordId,
  createHttpError,
  getUserIdentity,
  jsonResponse,
  MAX_FILE_SIZE_BYTES,
  normalizeContentType,
  normalizeFileSize,
  normalizeFilename,
  normalizeIsoDate,
  normalizeOptionalText,
  normalizeSearchText,
  optionsResponse,
  parseBody,
  normalizeTags,
  sanitizeDisplayName,
  sanitizeLabel,
  validateUploadKey
} = require("./shared");

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { S3_BUCKET_NAME, DYNAMODB_TABLE } = process.env;

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
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
    const body = parseBody(event);
    const action = String(body.action || "presign").trim().toLowerCase();

    if (!["presign", "complete"].includes(action)) {
      throw createHttpError(400, 'action must be either "presign" or "complete".');
    }

    if (action === "complete") {
      const fileId = String(body.fileId || "").trim();
      const displayName = sanitizeDisplayName(body.displayName);
      const originalFilename = normalizeFilename(body.originalFilename);
      const s3Key = validateUploadKey(identity.ownerSub, body.s3Key);
      const uploadedAt = normalizeIsoDate(body.uploadedAt, "uploadedAt") || new Date().toISOString();
      const size = normalizeFileSize(body.size);
      const contentType = normalizeContentType(body.contentType);
      const tags = normalizeTags(body.tags);
      const description = normalizeOptionalText(body.description, "description", 500);

      if (!fileId) {
        throw createHttpError(400, "fileId is required.");
      }

      if (!fileId.startsWith(`${identity.ownerSub}#`)) {
        throw createHttpError(403, "fileId does not belong to the authenticated user.");
      }

      const embeddingText = buildEmbeddingInput({
        fileName: displayName,
        tags,
        description
      });

      const embeddingVector = await getEmbedding(embeddingText);
      const createdAt = uploadedAt;
      const createdAtEpoch = Date.parse(createdAt);
      const fileType = contentType;

      const item = {
        filename: fileId,
        fileId,
        file_id: fileId,
        ownerSub: identity.ownerSub,
        ownerEmail: identity.email,
        ownerUsername: identity.username,
        displayName,
        file_name: displayName,
        originalFileName: originalFilename,
        normalizedFileName: normalizeSearchText(displayName),
        normalizedOriginalFilename: normalizeSearchText(originalFilename),
        displayNameLower: displayName.toLowerCase(),
        displayNameCompact: normalizeSearchText(displayName),
        originalFilename,
        originalFilenameLower: originalFilename.toLowerCase(),
        originalFilenameCompact: normalizeSearchText(originalFilename),
        filenameLower: displayName.toLowerCase(),
        s3Key,
        s3_key: s3Key,
        uploadedAt,
        uploadedAtEpoch: Date.parse(uploadedAt),
        createdAt,
        created_at: createdAt,
        createdAtEpoch,
        created_at_epoch: createdAtEpoch,
        size,
        contentType,
        fileType,
        file_type: fileType,
        accessCount: 0,
        access_count: 0,
        is_deleted: false,
        tags,
        tagsLower: tags.map((tag) => tag.toLowerCase()),
        tagsCompact: tags.map((tag) => normalizeSearchText(tag)),
        description,
        descriptionLower: description.toLowerCase(),
        descriptionCompact: normalizeSearchText(description),
        embeddingText,
        embeddingVector,
        embedding_vector: embeddingVector,
        embeddingStatus: "ready",
        embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        embeddingUpdatedAt: new Date().toISOString()
      };

      await dynamoClient.send(
        new PutCommand({
          TableName: DYNAMODB_TABLE,
          Item: item,
          ConditionExpression: "attribute_not_exists(filename)"
        })
      );

      return jsonResponse(
        200,
        {
          message: "File metadata saved successfully.",
          item
        },
        "OPTIONS,POST",
        event
      );
    }

    const originalFilename = normalizeFilename(body.originalFilename);
    const resolvedDisplayName = sanitizeDisplayName(body.displayName || originalFilename);
    const normalizedContentType = normalizeContentType(body.contentType);
    const cleanedName = sanitizeLabel(resolvedDisplayName);

    if (!cleanedName) {
      return jsonResponse(
        400,
        { message: "displayName contains no valid characters." },
        "OPTIONS,POST",
        event
      );
    }

    const fileId = buildRecordId(identity.ownerSub, resolvedDisplayName);
    const fileKey = `uploads/${identity.ownerSub}/${Date.now()}-${cleanedName}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
      ContentType: normalizedContentType,
      Metadata: {
        ownerSub: identity.ownerSub,
        displayName: cleanedName
      }
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300
    });

    return jsonResponse(
      200,
      {
        fileId,
        displayName: resolvedDisplayName,
        originalFilename,
        uploadUrl,
        fileKey,
        expiresIn: 300,
        maxUploadSizeBytes: MAX_FILE_SIZE_BYTES
      },
      "OPTIONS,POST",
      event
    );
  } catch (error) {
    console.error("uploadLambda failed", error);
    if (error.name === "ConditionalCheckFailedException") {
      error.statusCode = 409;
      error.message = "File metadata already exists for this upload.";
    }

    return jsonResponse(
      error.statusCode || 500,
      {
        message: error.statusCode === 401 ? "Authentication required." : "Failed to process upload request.",
        error: error.message
      },
      "OPTIONS,POST",
      event
    );
  }
};
