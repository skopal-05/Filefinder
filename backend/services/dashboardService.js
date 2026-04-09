const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  GetCommand
} = require("@aws-sdk/lib-dynamodb");
const { createHttpError, normalizeItem } = require("../shared");

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const { DYNAMODB_TABLE, OWNER_INDEX_NAME } = process.env;
const DEFAULT_RECENT_LIMIT = 10;
const DEFAULT_TOP_LIMIT = 10;

const isDeletedItem = (item) => Boolean(item.is_deleted ?? item.isDeleted ?? false);

const getCreatedAtValue = (item) => item.created_at || item.createdAt || item.uploadedAt || "";

const getCreatedAtDate = (item) => {
  const rawValue = getCreatedAtValue(item);
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getAccessCount = (item) => Number(item.access_count ?? item.accessCount ?? 0) || 0;

const withinDateRange = (item, dateFrom, dateTo) => {
  const createdAt = getCreatedAtDate(item);

  if (!createdAt) {
    return false;
  }

  if (dateFrom && createdAt < new Date(dateFrom)) {
    return false;
  }

  if (dateTo) {
    const inclusiveEnd = new Date(dateTo);
    inclusiveEnd.setUTCHours(23, 59, 59, 999);

    if (createdAt > inclusiveEnd) {
      return false;
    }
  }

  return true;
};

const classifyFileType = (item) => {
  const value = String(item.file_type || item.fileType || item.contentType || "").toLowerCase();

  if (value.includes("pdf")) {
    return "PDF";
  }

  if (value.startsWith("image/")) {
    return "Images";
  }

  if (
    value.includes("word") ||
    value.includes("document") ||
    value.includes("officedocument") ||
    value.includes("msword")
  ) {
    return "Docs";
  }

  return "Others";
};

const buildFileSummary = (item) => {
  const normalized = normalizeItem(item);
  return {
    file_id: normalized.fileId,
    file_name: normalized.displayName,
    file_type: normalized.fileType,
    created_at: normalized.createdAt,
    access_count: normalized.accessCount
  };
};

const sortByDateDescending = (left, right) => {
  const leftTime = getCreatedAtDate(left)?.getTime() || 0;
  const rightTime = getCreatedAtDate(right)?.getTime() || 0;
  return rightTime - leftTime;
};

const loadUserFiles = async (ownerSub) => {
  if (!DYNAMODB_TABLE) {
    throw createHttpError(500, "DynamoDB table is not configured.");
  }

  if (OWNER_INDEX_NAME) {
    try {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: DYNAMODB_TABLE,
          IndexName: OWNER_INDEX_NAME,
          KeyConditionExpression: "ownerSub = :ownerSub",
          ExpressionAttributeValues: {
            ":ownerSub": ownerSub
          },
          ScanIndexForward: false
        })
      );

      return result.Items || [];
    } catch (error) {
      if (error.name !== "ValidationException" && error.name !== "ResourceNotFoundException") {
        throw error;
      }
    }
  }

  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: DYNAMODB_TABLE,
      FilterExpression: "ownerSub = :ownerSub",
      ExpressionAttributeValues: {
        ":ownerSub": ownerSub
      }
    })
  );

  return result.Items || [];
};

const getDashboardData = async (ownerSub, filters = {}) => {
  const allItems = await loadUserFiles(ownerSub);
  const activeItems = allItems.filter((item) => !isDeletedItem(item));
  const filteredItems = activeItems.filter((item) =>
    withinDateRange(item, filters.dateFrom, filters.dateTo)
  );

  const recentUploads = filteredItems
    .slice()
    .sort(sortByDateDescending)
    .slice(0, DEFAULT_RECENT_LIMIT)
    .map(buildFileSummary);

  const mostAccessed = filteredItems
    .slice()
    .sort((left, right) => {
      const accessDelta = getAccessCount(right) - getAccessCount(left);
      return accessDelta !== 0 ? accessDelta : sortByDateDescending(left, right);
    })
    .slice(0, DEFAULT_TOP_LIMIT)
    .map(buildFileSummary);

  const trendsMap = filteredItems.reduce((accumulator, item) => {
    const createdAt = getCreatedAtDate(item);

    if (!createdAt) {
      return accumulator;
    }

    const key = createdAt.toISOString().slice(0, 10);
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());

  const uploadTrends = Array.from(trendsMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, uploads]) => ({ date, uploads }));

  const fileTypesMap = filteredItems.reduce((accumulator, item) => {
    const key = classifyFileType(item);
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map([
    ["PDF", 0],
    ["Images", 0],
    ["Docs", 0],
    ["Others", 0]
  ]));

  const fileTypes = Array.from(fileTypesMap.entries())
    .map(([type, count]) => ({ type, count }))
    .filter((entry) => entry.count > 0);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const topThisWeek = filteredItems
    .filter((item) => {
      const createdAt = getCreatedAtDate(item);
      return createdAt && createdAt >= oneWeekAgo;
    })
    .slice()
    .sort((left, right) => {
      const accessDelta = getAccessCount(right) - getAccessCount(left);
      return accessDelta !== 0 ? accessDelta : sortByDateDescending(left, right);
    })
    .slice(0, 5)
    .map(buildFileSummary);

  return {
    recentUploads,
    mostAccessed,
    uploadTrends,
    fileTypes,
    topThisWeek,
    summary: {
      totalFiles: filteredItems.length,
      totalAccesses: filteredItems.reduce((sum, item) => sum + getAccessCount(item), 0)
    }
  };
};

const incrementAccessCount = async (ownerSub, recordId) => {
  if (!recordId) {
    throw createHttpError(400, "fileId is required.");
  }

  if (!recordId.startsWith(`${ownerSub}#`)) {
    throw createHttpError(403, "You do not have permission to update this file.");
  }

  const existingRecord = await dynamoClient.send(
    new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { filename: recordId }
    })
  );

  if (!existingRecord.Item) {
    throw createHttpError(404, "File metadata not found.");
  }

  if (existingRecord.Item.ownerSub !== ownerSub) {
    throw createHttpError(403, "You do not have permission to update this file.");
  }

  if (isDeletedItem(existingRecord.Item)) {
    throw createHttpError(409, "Cannot track access for a deleted file.");
  }

  const result = await dynamoClient.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLE,
      Key: { filename: recordId },
      UpdateExpression:
        "SET access_count = if_not_exists(access_count, :zero) + :increment, accessCount = if_not_exists(accessCount, :zero) + :increment",
      ExpressionAttributeValues: {
        ":zero": 0,
        ":increment": 1
      },
      ReturnValues: "ALL_NEW"
    })
  );

  return {
    file_id: recordId,
    access_count: Number(result.Attributes?.access_count ?? result.Attributes?.accessCount ?? 0) || 0
  };
};

module.exports = {
  getDashboardData,
  incrementAccessCount,
  loadUserFiles
};
