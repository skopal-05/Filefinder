const { randomUUID } = require("node:crypto");

const MAX_FIELD_LENGTH = 160;
const MAX_QUERY_LENGTH = 120;
const MAX_METADATA_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;
const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_UPLOAD_SIZE_BYTES || 25 * 1024 * 1024);
const configuredOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getRequestOrigin = (event = {}) =>
  event.headers?.origin || event.headers?.Origin || "";

const getCorsHeaders = (event, methods) => {
  const requestOrigin = getRequestOrigin(event);
  const allowOrigin =
    configuredOrigins.length === 0
      ? "*"
      : configuredOrigins.includes(requestOrigin)
        ? requestOrigin
        : configuredOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin"
  };
};

const jsonResponse = (statusCode, body, methods = "OPTIONS,GET,POST,DELETE", event) => ({
  statusCode,
  headers: {
    ...getCorsHeaders(event, methods),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  body: JSON.stringify(body)
});

const optionsResponse = (methods, event) => ({
  statusCode: 204,
  headers: getCorsHeaders(event, methods)
});

const parseBody = (event) => {
  if (!event.body) {
    return {};
  }

  try {
    return typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch (error) {
    throw createHttpError(400, "Invalid JSON body.");
  }
};

const sanitizeLabel = (value) =>
  (value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");

const sanitizeDisplayName = (value, fieldName = "displayName") => {
  const normalizedValue = String(value || "").trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    throw createHttpError(400, `${fieldName} is required.`);
  }

  if (normalizedValue.length > MAX_FIELD_LENGTH) {
    throw createHttpError(400, `${fieldName} must be ${MAX_FIELD_LENGTH} characters or fewer.`);
  }

  return normalizedValue;
};

const normalizeFilename = (value, fieldName = "originalFilename") => {
  const normalizedValue = sanitizeDisplayName(value, fieldName);

  if (/[<>:"\\|?*\u0000-\u001f]/.test(normalizedValue)) {
    throw createHttpError(400, `${fieldName} contains unsupported characters.`);
  }

  return normalizedValue;
};

const normalizeContentType = (value) => {
  const normalizedValue = String(value || "application/octet-stream").trim().toLowerCase();

  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalizedValue)) {
    throw createHttpError(400, "contentType must be a valid MIME type.");
  }

  return normalizedValue;
};

const normalizeFileSize = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, "size must be a non-negative number.");
  }

  if (parsed > MAX_FILE_SIZE_BYTES) {
    throw createHttpError(400, `size exceeds the ${MAX_FILE_SIZE_BYTES} byte limit.`);
  }

  return Math.round(parsed);
};

const normalizeIsoDate = (value, fieldName) => {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid ISO date.`);
  }

  return parsed.toISOString();
};

const normalizeQueryValue = (value, fieldName, maxLength) => {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (normalizedValue.length > maxLength) {
    throw createHttpError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return normalizedValue;
};

const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeOptionalText = (value, fieldName, maxLength) => {
  const normalizedValue = String(value || "").trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue.length > maxLength) {
    throw createHttpError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return normalizedValue;
};

const normalizeTags = (value) => {
  const tags = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  if (tags.length > MAX_TAGS) {
    throw createHttpError(400, `tags must contain ${MAX_TAGS} items or fewer.`);
  }

  return tags.map((tag) => {
    const normalizedTag = normalizeOptionalText(tag, "tag", MAX_TAG_LENGTH);

    if (!normalizedTag) {
      throw createHttpError(400, "tags cannot contain empty values.");
    }

    return normalizedTag;
  });
};

const validateUploadKey = (ownerSub, s3Key) => {
  const normalizedKey = String(s3Key || "").trim();

  if (!normalizedKey) {
    throw createHttpError(400, "s3Key is required.");
  }

  if (!normalizedKey.startsWith(`uploads/${ownerSub}/`)) {
    throw createHttpError(403, "s3Key does not belong to the authenticated user.");
  }

  return normalizedKey;
};

const validateSearchFilters = (queryParams = {}) => {
  const query = normalizeQueryValue(queryParams.query || queryParams.filename, "query", MAX_QUERY_LENGTH);
  const metadata = normalizeQueryValue(queryParams.metadata, "metadata", MAX_METADATA_LENGTH);
  const fileType = normalizeQueryValue(queryParams.fileType, "fileType", 40);
  const dateFrom = normalizeIsoDate(queryParams.dateFrom, "dateFrom");
  const dateTo = normalizeIsoDate(queryParams.dateTo, "dateTo");

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    throw createHttpError(400, "dateFrom must be earlier than or equal to dateTo.");
  }

  return {
    query,
    metadata,
    fileType,
    dateFrom,
    dateTo
  };
};

const validateSearchRequest = (event) => {
  const body = event.body ? parseBody(event) : {};
  const source =
    event.httpMethod === "GET" || event.requestContext?.http?.method === "GET"
      ? event.queryStringParameters || {}
      : body;
  const filters = validateSearchFilters(source);
  const limit = Math.min(Math.max(Number(source.limit || 10), 1), 25);

  return {
    ...filters,
    limit
  };
};

const validateDashboardFilters = (queryParams = {}) => {
  const dateFrom = normalizeIsoDate(queryParams.dateFrom, "dateFrom");
  const dateTo = normalizeIsoDate(queryParams.dateTo, "dateTo");

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    throw createHttpError(400, "dateFrom must be earlier than or equal to dateTo.");
  }

  return {
    dateFrom,
    dateTo
  };
};

const getClaims = (event) =>
  event.requestContext?.authorizer?.claims || event.requestContext?.authorizer?.jwt?.claims || {};

const getUserIdentity = (event) => {
  const claims = getClaims(event);
  const ownerSub = claims.sub;

  if (!ownerSub) {
    throw createHttpError(401, "Unauthorized request.");
  }

  return {
    ownerSub,
    email: claims.email || "",
    username: claims["cognito:username"] || claims.username || ""
  };
};

const buildRecordId = (ownerSub, displayName) => {
  const safeName = sanitizeLabel(displayName) || "file";
  return `${ownerSub}#${randomUUID()}#${safeName}`;
};

const normalizeItem = (item) => ({
  fileId: item.fileId || item.filename,
  displayName: item.displayName || item.originalFilename || item.filename,
  originalFilename: item.originalFilename || item.displayName || item.filename,
  tags: Array.isArray(item.tags) ? item.tags : [],
  description: item.description || "",
  s3Key: item.s3Key,
  uploadedAt: item.uploadedAt || item.created_at || item.createdAt,
  createdAt: item.created_at || item.createdAt || item.uploadedAt,
  size: item.size || 0,
  contentType: item.contentType || "application/octet-stream",
  fileType: item.file_type || item.fileType || item.contentType || "application/octet-stream",
  accessCount: Number(item.access_count ?? item.accessCount ?? 0) || 0,
  isDeleted: Boolean(item.is_deleted ?? item.isDeleted ?? false),
  searchScore: Number.isFinite(item.searchScore) ? item.searchScore : undefined,
  searchStrategy: item.searchStrategy || undefined
});

module.exports = {
  buildRecordId,
  createHttpError,
  getUserIdentity,
  jsonResponse,
  MAX_FILE_SIZE_BYTES,
  normalizeItem,
  normalizeContentType,
  normalizeOptionalText,
  normalizeFileSize,
  normalizeFilename,
  normalizeIsoDate,
  normalizeSearchText,
  normalizeTags,
  optionsResponse,
  parseBody,
  sanitizeDisplayName,
  sanitizeLabel,
  validateDashboardFilters,
  validateSearchFilters,
  validateSearchRequest,
  validateUploadKey
};
