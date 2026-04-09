const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { buildEmbeddingInput, getEmbedding } = require("./services/embeddingService");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const { DYNAMODB_TABLE } = process.env;

const backfillEmbeddings = async () => {
  if (!DYNAMODB_TABLE) {
    throw new Error("DYNAMODB_TABLE is required.");
  }

  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "attribute_not_exists(embeddingVector) OR size(embeddingVector) = :empty",
      ExpressionAttributeValues: {
        ":empty": 0
      }
    })
  );

  for (const item of result.Items || []) {
    const embeddingText = buildEmbeddingInput({
      fileName: item.file_name || item.fileName || item.displayName || item.originalFilename,
      tags: item.tags,
      description: item.description
    });

    try {
      const embeddingVector = await getEmbedding(embeddingText);

      await dynamoClient.send(
        new UpdateCommand({
          TableName: DYNAMODB_TABLE,
          Key: {
            filename: item.filename
          },
          UpdateExpression:
            "SET embeddingText = :embeddingText, embeddingVector = :embeddingVector, embedding_vector = :embeddingVectorLegacy, embeddingStatus = :status, embeddingModel = :model, embeddingUpdatedAt = :updatedAt REMOVE embeddingError",
          ExpressionAttributeValues: {
            ":embeddingText": embeddingText,
            ":embeddingVector": embeddingVector,
            ":embeddingVectorLegacy": embeddingVector,
            ":status": "ready",
            ":model": process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
            ":updatedAt": new Date().toISOString()
          }
        })
      );

      console.log(`Backfilled embedding for ${item.filename}`);
    } catch (error) {
      console.error(`Failed to backfill embedding for ${item.filename}`, error.message);
    }
  }
};

backfillEmbeddings().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
