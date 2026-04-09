export const fetchDashboardData = async (authenticatedFetch, filters = {}) => {
  const params = new URLSearchParams();

  if (filters.dateFrom) {
    params.set("dateFrom", filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set("dateTo", filters.dateTo);
  }

  const response = await authenticatedFetch(
    `/dashboard${params.toString() ? `?${params.toString()}` : ""}`
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to load dashboard data.");
  }

  return data;
};

export const trackFileAccess = async (authenticatedFetch, fileId) => {
  const response = await authenticatedFetch("/file/access", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fileId })
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to update file analytics.");
  }

  return data;
};
