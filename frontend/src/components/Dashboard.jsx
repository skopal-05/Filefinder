import { useEffect, useMemo, useState } from "react";
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fetchDashboardData } from "../services/dashboardService";

const PIE_COLORS = ["#7aa2ff", "#50c6a2", "#ffd166", "#ff8c82"];

const defaultFilters = {
  dateFrom: "",
  dateTo: ""
};

const formatChartDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));

const formatFilterDate = (value) => {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
};

const formatDateInputValue = (value) => {
  if (!value) {
    return "";
  }

  const [year, month, day] = String(value).split("-");

  if (!year || !month || !day) {
    return "";
  }

  return `${day}/${month}/${year}`;
};

const parseDateInputValue = (value) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  const isoDate = `${year}-${month}-${day}`;
  const parsed = new Date(`${isoDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() + 1 !== Number(month) ||
    parsed.getDate() !== Number(day)
  ) {
    return null;
  }

  return isoDate;
};

const getCreatedAt = (file) => file.createdAt || file.uploadedAt || "";

const getCreatedAtDate = (file) => {
  const value = getCreatedAt(file);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getAccessCount = (file) => Number(file.accessCount ?? file.access_count ?? 0) || 0;

const classifyFileType = (file) => {
  const value = String(file.fileType || file.contentType || "").toLowerCase();

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

const withinDateRange = (file, dateFrom, dateTo) => {
  const createdAt = getCreatedAtDate(file);

  if (!createdAt) {
    return false;
  }

  if (dateFrom && createdAt < new Date(dateFrom)) {
    return false;
  }

  if (dateTo) {
    const inclusiveEnd = new Date(dateTo);
    inclusiveEnd.setHours(23, 59, 59, 999);

    if (createdAt > inclusiveEnd) {
      return false;
    }
  }

  return true;
};

const buildFileSummary = (file) => ({
  file_id: file.fileId,
  file_name: file.displayName,
  file_type: file.fileType || file.contentType || "application/octet-stream",
  created_at: getCreatedAt(file),
  access_count: getAccessCount(file)
});

const buildDashboardFromFiles = (files, filters) => {
  const filteredFiles = files.filter((file) =>
    withinDateRange(file, filters.dateFrom, filters.dateTo)
  );

  const recentUploads = filteredFiles
    .slice()
    .sort((left, right) => (getCreatedAtDate(right)?.getTime() || 0) - (getCreatedAtDate(left)?.getTime() || 0))
    .slice(0, 10)
    .map(buildFileSummary);

  const mostAccessed = filteredFiles
    .slice()
    .sort((left, right) => {
      const accessDelta = getAccessCount(right) - getAccessCount(left);

      if (accessDelta !== 0) {
        return accessDelta;
      }

      return (getCreatedAtDate(right)?.getTime() || 0) - (getCreatedAtDate(left)?.getTime() || 0);
    })
    .slice(0, 10)
    .map(buildFileSummary);

  const uploadTrendsMap = filteredFiles.reduce((accumulator, file) => {
    const createdAt = getCreatedAtDate(file);

    if (!createdAt) {
      return accumulator;
    }

    const key = createdAt.toISOString().slice(0, 10);
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());

  const uploadTrends = Array.from(uploadTrendsMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, uploads]) => ({ date, uploads }));

  const fileTypesMap = filteredFiles.reduce(
    (accumulator, file) => {
      const type = classifyFileType(file);
      accumulator.set(type, (accumulator.get(type) || 0) + 1);
      return accumulator;
    },
    new Map([
      ["PDF", 0],
      ["Images", 0],
      ["Docs", 0],
      ["Others", 0]
    ])
  );

  const fileTypes = Array.from(fileTypesMap.entries())
    .map(([type, count]) => ({ type, count }))
    .filter((entry) => entry.count > 0);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const topThisWeek = filteredFiles
    .filter((file) => {
      const createdAt = getCreatedAtDate(file);
      return createdAt && createdAt >= oneWeekAgo;
    })
    .slice()
    .sort((left, right) => getAccessCount(right) - getAccessCount(left))
    .slice(0, 5)
    .map(buildFileSummary);

  return {
    success: true,
    recentUploads,
    mostAccessed,
    uploadTrends,
    fileTypes,
    topThisWeek,
    summary: {
      totalFiles: filteredFiles.length,
      totalAccesses: filteredFiles.reduce((sum, file) => sum + getAccessCount(file), 0)
    }
  };
};

function Dashboard({ authenticatedFetch, refreshToken, formatDateTime }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [dateInputs, setDateInputs] = useState({
    dateFrom: "",
    dateTo: ""
  });
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setDateInputs({
      dateFrom: formatDateInputValue(filters.dateFrom),
      dateTo: formatDateInputValue(filters.dateTo)
    });
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    let isCancelled = false;

    const loadDashboard = async () => {
      setIsLoading(true);
      setError("");

      try {
        let nextDashboard;

        try {
          nextDashboard = await fetchDashboardData(authenticatedFetch, filters);
        } catch (dashboardError) {
          const filesResponse = await authenticatedFetch("/files");
          const filesData = await filesResponse.json();

          if (!filesResponse.ok) {
            throw new Error(filesData.message || dashboardError.message || "Failed to load dashboard data.");
          }

          nextDashboard = buildDashboardFromFiles(filesData.files || [], filters);
        }

        if (!isCancelled) {
          setDashboard(nextDashboard);
          setError("");
        }
      } catch (requestError) {
        if (!isCancelled) {
          setDashboard(null);
          setError(
            requestError.message === "Failed to fetch"
              ? "Dashboard is unavailable right now. Check the API deployment or CORS settings."
              : requestError.message
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      isCancelled = true;
    };
  }, [authenticatedFetch, filters, refreshToken]);

  const summary = dashboard?.summary || { totalFiles: 0, totalAccesses: 0 };

  const chartData = useMemo(() => {
    return {
      uploadTrends: dashboard?.uploadTrends || [],
      fileTypes: dashboard?.fileTypes || []
    };
  }, [dashboard]);

  const dateRangeLabel = useMemo(() => {
    if (filters.dateFrom && filters.dateTo) {
      return `${formatFilterDate(filters.dateFrom)} to ${formatFilterDate(filters.dateTo)}`;
    }

    if (filters.dateFrom) {
      return `From ${formatFilterDate(filters.dateFrom)}`;
    }

    if (filters.dateTo) {
      return `Up to ${formatFilterDate(filters.dateTo)}`;
    }

    return "Showing all available activity across your workspace.";
  }, [filters.dateFrom, filters.dateTo]);

  const handleDateInputChange = (key, value) => {
    const sanitized = value.replace(/[^\d/]/g, "").slice(0, 10);
    setDateInputs((current) => ({ ...current, [key]: sanitized }));
  };

  const handleDateInputBlur = (key) => {
    const parsedValue = parseDateInputValue(dateInputs[key]);

    if (dateInputs[key] === "") {
      setFilters((current) => ({ ...current, [key]: "" }));
      setError("");
      return;
    }

    if (!parsedValue) {
      setError("Enter dates in DD/MM/YYYY format.");
      return;
    }

    setError("");
    setFilters((current) => ({ ...current, [key]: parsedValue }));
  };

  return (
    <section id="dashboard" className="content-section">
      <div className="section-heading section-heading-inline dashboard-heading">
        <div>
          <p className="eyebrow">Activity Dashboard</p>
          <h2 className="section-title">Track uploads, usage, and file mix at a glance.</h2>
          <p className="section-copy">
            Recent uploads, your most opened files, and lightweight analytics built on top of your
            existing serverless file metadata.
          </p>
        </div>

        <div className="dashboard-filter-panel">
          <div className="dashboard-filter-copy">
            <span className="dashboard-filter-label">Analytics Window</span>
            <strong>{dateRangeLabel}</strong>
          </div>

          <div className="dashboard-filter-bar">
            <label className="dashboard-date-field">
              <span>From</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={dateInputs.dateFrom}
                onChange={(event) =>
                  handleDateInputChange("dateFrom", event.target.value)
                }
                onBlur={() => handleDateInputBlur("dateFrom")}
                aria-label="Filter dashboard from date"
              />
            </label>
            <label className="dashboard-date-field">
              <span>To</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD/MM/YYYY"
                value={dateInputs.dateTo}
                onChange={(event) =>
                  handleDateInputChange("dateTo", event.target.value)
                }
                onBlur={() => handleDateInputBlur("dateTo")}
                aria-label="Filter dashboard to date"
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setFilters(defaultFilters);
                setDateInputs(defaultFilters);
                setError("");
              }}
              disabled={!filters.dateFrom && !filters.dateTo}
            >
              Reset Range
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="status-banner error">{error}</div> : null}

      <section className="dashboard-summary-grid">
        <article className="metric-card">
          <span className="metric-title">Files In Scope</span>
          <strong className="metric-value">{summary.totalFiles}</strong>
          <p>Non-deleted files included in the selected range.</p>
        </article>
        <article className="metric-card">
          <span className="metric-title">Tracked Opens</span>
          <strong className="metric-value">{summary.totalAccesses}</strong>
          <p>Preview and download events counted through the access endpoint.</p>
        </article>
        <article className="metric-card">
          <span className="metric-title">Recent Uploads</span>
          <strong className="metric-value">{dashboard?.recentUploads?.length || 0}</strong>
          <p>Latest files sorted by upload timestamp.</p>
        </article>
        <article className="metric-card">
          <span className="metric-title">Top This Week</span>
          <strong className="metric-value">{dashboard?.topThisWeek?.length || 0}</strong>
          <p>Most accessed files created within the last seven days.</p>
        </article>
      </section>

      {isLoading ? (
        <section className="dashboard-grid">
          <div className="panel dashboard-card dashboard-skeleton"></div>
          <div className="panel dashboard-card dashboard-skeleton"></div>
          <div className="panel dashboard-card dashboard-skeleton"></div>
          <div className="panel dashboard-card dashboard-skeleton"></div>
        </section>
      ) : (
        <section className="dashboard-grid">
          <article className="panel dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <p className="eyebrow">Recent Uploads</p>
                <h3>Last 10 files</h3>
              </div>
            </div>

            {dashboard?.recentUploads?.length ? (
              <div className="dashboard-list">
                {dashboard.recentUploads.map((file) => (
                  <div className="dashboard-list-row" key={file.file_id}>
                    <div>
                      <strong>{file.file_name}</strong>
                      <span>{file.file_type || "Unknown type"}</span>
                    </div>
                    <time>{formatDateTime(file.created_at)}</time>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No uploads found for this date range.</div>
            )}
          </article>

          <article className="panel dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <p className="eyebrow">Most Accessed</p>
                <h3>Top 10 files</h3>
              </div>
            </div>

            {dashboard?.mostAccessed?.length ? (
              <div className="dashboard-list">
                {dashboard.mostAccessed.map((file) => (
                  <div className="dashboard-list-row" key={file.file_id}>
                    <div>
                      <strong>{file.file_name}</strong>
                      <span>{file.file_type || "Unknown type"}</span>
                    </div>
                    <span className="dashboard-pill">{file.access_count} opens</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Access analytics will appear after users open files.</div>
            )}
          </article>

          <article className="panel dashboard-card dashboard-chart-card">
            <div className="dashboard-card-header">
              <div>
                <p className="eyebrow">Upload Trends</p>
                <h3>Files uploaded per day</h3>
              </div>
            </div>

            {chartData.uploadTrends.length ? (
              <div className="chart-shell">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData.uploadTrends}>
                    <XAxis dataKey="date" tickFormatter={formatChartDate} stroke="rgba(220, 228, 255, 0.65)" />
                    <YAxis allowDecimals={false} stroke="rgba(220, 228, 255, 0.65)" />
                    <Tooltip
                      formatter={(value) => [`${value} upload${value === 1 ? "" : "s"}`, "Uploads"]}
                      labelFormatter={formatChartDate}
                    />
                    <Line
                      type="monotone"
                      dataKey="uploads"
                      stroke="#7aa2ff"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#7aa2ff" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state">Upload activity will appear here once files are added.</div>
            )}
          </article>

          <article className="panel dashboard-card dashboard-chart-card">
            <div className="dashboard-card-header">
              <div>
                <p className="eyebrow">File Types</p>
                <h3>Distribution by category</h3>
              </div>
            </div>

            {chartData.fileTypes.length ? (
              <div className="chart-shell">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={chartData.fileTypes}
                      dataKey="count"
                      nameKey="type"
                      innerRadius={68}
                      outerRadius={100}
                      paddingAngle={4}
                    >
                      {chartData.fileTypes.map((entry, index) => (
                        <Cell key={entry.type} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} file${value === 1 ? "" : "s"}`, "Count"]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state">File type analytics will appear after uploads are indexed.</div>
            )}
          </article>
        </section>
      )}
    </section>
  );
}

export default Dashboard;
