const {
  getUserIdentity,
  jsonResponse,
  optionsResponse,
  parseBody,
  validateDashboardFilters
} = require("../shared");
const { getDashboardData, incrementAccessCount } = require("../services/dashboardService");

const dashboardHandler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return optionsResponse("OPTIONS,GET", event);
  }

  try {
    const identity = getUserIdentity(event);
    const filters = validateDashboardFilters(event.queryStringParameters || {});
    const data = await getDashboardData(identity.ownerSub, filters);

    return jsonResponse(
      200,
      {
        success: true,
        ...data
      },
      "OPTIONS,GET",
      event
    );
  } catch (error) {
    console.error("dashboardHandler failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        success: false,
        message:
          error.statusCode === 401
            ? "Authentication required."
            : "Failed to load dashboard data.",
        error: error.message
      },
      "OPTIONS,GET",
      event
    );
  }
};

const accessHandler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return optionsResponse("OPTIONS,POST", event);
  }

  try {
    const identity = getUserIdentity(event);
    const body = parseBody(event);
    const fileId = String(body.fileId || body.file_id || "").trim();
    const data = await incrementAccessCount(identity.ownerSub, fileId);

    return jsonResponse(
      200,
      {
        success: true,
        ...data
      },
      "OPTIONS,POST",
      event
    );
  } catch (error) {
    console.error("accessHandler failed", error);

    return jsonResponse(
      error.statusCode || 500,
      {
        success: false,
        message:
          error.statusCode === 401
            ? "Authentication required."
            : "Failed to update access count.",
        error: error.message
      },
      "OPTIONS,POST",
      event
    );
  }
};

module.exports = {
  dashboardHandler,
  accessHandler
};
