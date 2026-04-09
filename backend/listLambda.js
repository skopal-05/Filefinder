const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  getUserIdentity,
  jsonResponse,
  normalizeItem,
  optionsResponse
} = require("./shared");

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { OWNER_INDEX_NAME, S3_BUCKET_NAME, DYNAMODB_TABLE } = process.env;
const DEFAULT_LIST_LIMIT = Number(process.env.LIST_PAGE_SIZE || 100);

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
          Limit: DEFAULT_LIST_LIMIT
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

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return optionsResponse("OPTIONS,GET", event);
  }

  if (!S3_BUCKET_NAME || !DYNAMODB_TABLE) {
    return jsonResponse(500, { message: "Missing required environment variables." }, "OPTIONS,GET", event);
  }

  try {
    const identity = getUserIdentity(event);
    const result = await loadUserItems(identity.ownerSub);
    const files = await Promise.all(
      (result.Items || [])
        .filter((item) => !Boolean(item.is_deleted ?? item.isDeleted ?? false))
        .map(withDownloadUrl)
    );
    files.sort((left, right) => new Date(right.uploadedAt) - new Date(left.uploadedAt));

    return jsonResponse(200, { files }, "OPTIONS,GET", event);
  } catch (error) {
    console.error("listLambda failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        message: error.statusCode === 401 ? "Authentication required." : "Failed to list files.",
        error: error.message
      },
      "OPTIONS,GET",
      event
    );
  }
};
