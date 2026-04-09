const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand
} = require("@aws-sdk/lib-dynamodb");
const {
  createHttpError,
  getUserIdentity,
  jsonResponse,
  optionsResponse,
  parseBody
} = require("./shared");

const s3Client = new S3Client({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { S3_BUCKET_NAME, DYNAMODB_TABLE } = process.env;

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return optionsResponse("OPTIONS,DELETE", event);
  }

  if (!S3_BUCKET_NAME || !DYNAMODB_TABLE) {
    return jsonResponse(
      500,
      { message: "Missing required environment variables." },
      "OPTIONS,DELETE",
      event
    );
  }

  try {
    const identity = getUserIdentity(event);
    const { fileId, filename } = parseBody(event);
    const recordId = String(fileId || filename || "").trim();

    if (!recordId) {
      return jsonResponse(400, { message: "fileId is required." }, "OPTIONS,DELETE", event);
    }

    if (!recordId.startsWith(`${identity.ownerSub}#`)) {
      throw createHttpError(403, "You do not have permission to delete this file.");
    }

    const existingRecord = await dynamoClient.send(
      new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key: { filename: recordId }
      })
    );

    if (!existingRecord.Item) {
      return jsonResponse(404, { message: "File metadata not found." }, "OPTIONS,DELETE", event);
    }

    if (existingRecord.Item.ownerSub !== identity.ownerSub) {
      return jsonResponse(
        403,
        { message: "You do not have permission to delete this file." },
        "OPTIONS,DELETE",
        event
      );
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: existingRecord.Item.s3Key
      })
    );

    await dynamoClient.send(
      new DeleteCommand({
        TableName: DYNAMODB_TABLE,
        Key: { filename: recordId }
      })
    );

    return jsonResponse(200, { message: "File deleted successfully." }, "OPTIONS,DELETE", event);
  } catch (error) {
    console.error("deleteLambda failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        message: error.statusCode === 401 ? "Authentication required." : "Failed to delete file.",
        error: error.message
      },
      "OPTIONS,DELETE",
      event
    );
  }
};
