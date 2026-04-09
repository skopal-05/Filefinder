const { normalizeSearchText, createHttpError } = require("./shared");

const DEFAULT_PARTIAL_LIMIT = 10;
const MAX_PARTIAL_LIMIT = 25;
const MIN_FUZZY_SCORE = Number(process.env.PARTIAL_SEARCH_MIN_FUZZY_SCORE || 0.72);

const levenshteinDistance = (left, right) => {
  const a = String(left || "");
  const b = String(right || "");

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const previous = new Array(b.length + 1).fill(0);
  const current = new Array(b.length + 1).fill(0);

  for (let column = 0; column <= b.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }

    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[b.length];
};

const similarityScore = (left, right) => {
  const maxLength = Math.max(left.length, right.length);

  if (!maxLength) {
    return 0;
  }

  return 1 - levenshteinDistance(left, right) / maxLength;
};

const collectCandidateStrings = (item) =>
  [
    item.normalizedFileName,
    item.normalizedOriginalFilename,
    item.displayNameCompact,
    item.originalFilenameCompact,
    normalizeSearchText(item.displayName),
    normalizeSearchText(item.originalFilename)
  ].filter(Boolean);

const scoreCandidate = (normalizedQuery, normalizedValue) => {
  if (!normalizedQuery || !normalizedValue) {
    return null;
  }

  if (normalizedValue === normalizedQuery) {
    return {
      matchType: "exact",
      score: 1
    };
  }

  if (normalizedValue.includes(normalizedQuery)) {
    const coverage = normalizedQuery.length / normalizedValue.length;

    return {
      matchType: "substring",
      score: 0.9 + Math.min(coverage, 0.09)
    };
  }

  let bestWindowScore = 0;

  if (normalizedQuery.length > 1 && normalizedValue.length >= normalizedQuery.length) {
    for (let index = 0; index <= normalizedValue.length - normalizedQuery.length; index += 1) {
      const window = normalizedValue.slice(index, index + normalizedQuery.length);
      bestWindowScore = Math.max(bestWindowScore, similarityScore(normalizedQuery, window));
    }
  }

  const fullValueScore = similarityScore(normalizedQuery, normalizedValue);
  const fuzzyScore = Math.max(bestWindowScore, fullValueScore);

  if (fuzzyScore >= MIN_FUZZY_SCORE) {
    return {
      matchType: "fuzzy",
      score: fuzzyScore
    };
  }

  return null;
};

const rankPartialMatches = ({ items, query, limit = DEFAULT_PARTIAL_LIMIT }) => {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    throw createHttpError(400, "query is required.");
  }

  const ranked = items
    .map((item) => {
      const bestMatch = collectCandidateStrings(item)
        .map((candidate) => scoreCandidate(normalizedQuery, candidate))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score)[0];

      if (!bestMatch) {
        return null;
      }

      return {
        ...item,
        searchScore: bestMatch.score,
        searchStrategy: bestMatch.matchType
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.searchScore !== left.searchScore) {
        return right.searchScore - left.searchScore;
      }

      return new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0);
    });

  return ranked.slice(0, Math.min(Math.max(Number(limit || DEFAULT_PARTIAL_LIMIT), 1), MAX_PARTIAL_LIMIT));
};

const validatePartialSearchRequest = (event) => {
  let body = {};

  if (event.body) {
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch (error) {
      throw createHttpError(400, "Invalid JSON body.");
    }
  }

  const query = String(body.query || "").trim();
  const fileType = String(body.fileType || "").trim().toLowerCase();
  let dateFrom = "";
  let dateTo = "";
  const limit = Math.min(Math.max(Number(body.limit || DEFAULT_PARTIAL_LIMIT), 1), MAX_PARTIAL_LIMIT);

  if (!query) {
    throw createHttpError(400, "query is required.");
  }

  if (body.dateFrom) {
    const parsedDateFrom = new Date(body.dateFrom);

    if (Number.isNaN(parsedDateFrom.getTime())) {
      throw createHttpError(400, "dateFrom must be a valid ISO date.");
    }

    dateFrom = parsedDateFrom.toISOString();
  }

  if (body.dateTo) {
    const parsedDateTo = new Date(body.dateTo);

    if (Number.isNaN(parsedDateTo.getTime())) {
      throw createHttpError(400, "dateTo must be a valid ISO date.");
    }

    dateTo = parsedDateTo.toISOString();
  }

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    throw createHttpError(400, "dateFrom must be earlier than or equal to dateTo.");
  }

  return {
    query,
    fileType,
    dateFrom,
    dateTo,
    limit
  };
};

module.exports = {
  collectCandidateStrings,
  levenshteinDistance,
  rankPartialMatches,
  similarityScore,
  validatePartialSearchRequest
};
