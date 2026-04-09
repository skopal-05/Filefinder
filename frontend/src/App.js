import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./components/AuthPanel";
import Dashboard from "./components/Dashboard";
import Upload from "./components/Upload";
import Search from "./components/Search";
import FileList from "./components/FileList";
import PreviewModal from "./components/PreviewModal";
import { confirmSignUp, getSession, signIn, signOut, signUp } from "./auth";
import { trackFileAccess } from "./services/dashboardService";

const API_URL = process.env.REACT_APP_API_URL;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_SEARCH_FIELD_LENGTH = 120;

const defaultFilters = {
  query: "",
  metadata: "",
  fileType: "",
  dateFrom: "",
  dateTo: ""
};

const textPreviewTypes = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml"
];

const formatDateTime = (value) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));

const formatBytes = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), sizes.length - 1);
  const amount = value / 1024 ** index;

  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${sizes[index]}`;
};

const STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "file",
  "files",
  "find",
  "for",
  "me",
  "my",
  "of",
  "related",
  "search",
  "show",
  "the",
  "to"
]);

const buildSearchQuery = (filters) => {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value.trim()) {
      params.set(key, value.trim());
    }
  });

  return params.toString();
};

const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const extractSearchTerms = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));

const localSemanticFallback = (files, filters) => {
  const terms = extractSearchTerms(filters.query);
  const compactQuery = normalizeSearchText(filters.query);

  return files
    .map((file) => {
      const haystack = [
        file.displayName,
        file.originalFilename,
        file.contentType,
        file.s3Key
      ]
        .join(" ")
        .toLowerCase();
      const compactHaystack = normalizeSearchText(haystack);

      let score = 0;

      for (const term of terms) {
        if (haystack.includes(term)) {
          score += 1;
        }
      }

      if (compactQuery && compactHaystack.includes(compactQuery)) {
        score += 1.5;
      }

      if (
        filters.fileType.trim() &&
        ![file.contentType, file.originalFilename].join(" ").toLowerCase().includes(filters.fileType.trim().toLowerCase())
      ) {
        score = 0;
      }

      if (filters.dateFrom.trim()) {
        const selectedDate = new Date(filters.dateFrom).toISOString().slice(0, 10);
        const fileDate = String(file.uploadedAt || "").slice(0, 10);

        if (selectedDate !== fileDate) {
          score = 0;
        }
      }

      return {
        ...file,
        localScore: score
      };
    })
    .filter((file) => file.localScore > 0)
    .sort((left, right) => right.localScore - left.localScore);
};

const hasActiveFilters = (filters) =>
  Object.values(filters).some((value) => value.trim());

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("filefinder-theme");

    if (savedTheme) {
      return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [session, setSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressLabel, setUploadProgressLabel] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [isSearching, setIsSearching] = useState(false);
  const [deletingFile, setDeletingFile] = useState("");
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);
  const [previewState, setPreviewState] = useState({
    file: null,
    textContent: "",
    isLoading: false,
    error: ""
  });

  const dashboardStats = useMemo(() => {
    const totalFiles = files.length;
    const totalStorage = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const latestUpload = files[0]?.uploadedAt;

    return {
      totalFiles,
      totalStorage: formatBytes(totalStorage),
      latestUpload: latestUpload ? formatDateTime(latestUpload) : "No uploads yet"
    };
  }, [files]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((value) => value.trim()).length,
    [filters]
  );

  const authenticatedFetch = useCallback(
    async (path, options = {}) => {
      if (!API_URL) {
        throw new Error("REACT_APP_API_URL is not configured.");
      }

      if (!session?.token) {
        throw new Error("You must be signed in to use FileFinder.");
      }

      const headers = new Headers(options.headers || {});
      headers.set("Authorization", session.token);

      const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
        mode: "cors"
      });

      if (response.status === 401) {
        signOut();
        setSession(null);
        setFiles([]);
        throw new Error("Your session expired. Please sign in again.");
      }

      return response;
    },
    [session]
  );

  const fetchFiles = useCallback(async () => {
    if (!session?.token) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await authenticatedFetch("/files");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to load files.");
      }

      setFiles(data.files || []);
      setSelectedFileIds([]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedFetch, session]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("filefinder-theme", theme);
  }, [theme]);

  useEffect(() => {
    const initializeSession = async () => {
      try {
        setSession(await getSession());
      } catch (sessionError) {
        setAuthError(sessionError.message);
      } finally {
        setIsAuthLoading(false);
      }
    };

    initializeSession();
  }, []);

  useEffect(() => {
    if (session?.token) {
      fetchFiles();
    }
  }, [fetchFiles, session]);

  const runSearch = async (nextFilters) => {
    const normalizedFilters = nextFilters || filters;

    setError("");
    setMessage("");

    if (!hasActiveFilters(normalizedFilters)) {
      await fetchFiles();
      return;
    }

    setIsLoading(true);
    setIsSearching(true);

    try {
      let response;
      let data;

      try {
        response = await authenticatedFetch("/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: normalizedFilters.query,
            fileType: normalizedFilters.fileType,
            date: normalizedFilters.dateFrom
              ? new Date(normalizedFilters.dateFrom).toISOString().slice(0, 10)
              : "",
            limit: 10
          })
        });
        data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to search files.");
        }

        setFiles(data.files || []);
        setSelectedFileIds([]);
        setMessage(
          data.results?.length
            ? `Search found ${data.results.length} relevant file${data.results.length === 1 ? "" : "s"}.`
            : "No relevant files found."
        );
      } catch (primarySearchError) {
        const queryString = buildSearchQuery(normalizedFilters);
        response = await authenticatedFetch(`/search?${queryString}`);
        data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || primarySearchError.message || "Failed to search files.");
        }

        let resolvedFiles = data.files || [];

        if (resolvedFiles.length === 0) {
          const filesResponse = await authenticatedFetch("/files");
          const filesData = await filesResponse.json();

          if (!filesResponse.ok) {
            throw new Error(filesData.message || "Failed to load files for fallback search.");
          }

          resolvedFiles = localSemanticFallback(filesData.files || [], normalizedFilters);
        }

        setFiles(resolvedFiles);
        setSelectedFileIds([]);
        setMessage(
          resolvedFiles.length
            ? `Search found ${resolvedFiles.length} file${resolvedFiles.length === 1 ? "" : "s"}.`
            : "No files found."
        );
      }
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setIsLoading(false);
      setIsSearching(false);
    }
  };

  const handleFilterChange = (updater) => {
    setFilters((current) => {
      const nextFilters = typeof updater === "function" ? updater(current) : updater;

      return {
        ...nextFilters,
        query: nextFilters.query.slice(0, MAX_SEARCH_FIELD_LENGTH),
        metadata: nextFilters.metadata.slice(0, MAX_SEARCH_FIELD_LENGTH),
        fileType: nextFilters.fileType.slice(0, 40)
      };
    });
  };

  const recordAccess = useCallback(
    async (fileId) => {
      try {
        await trackFileAccess(authenticatedFetch, fileId);
        setDashboardRefreshToken((current) => current + 1);
      } catch (requestError) {
        console.error("Failed to track file access", requestError);
      }
    },
    [authenticatedFetch]
  );

  const uploadSingleFile = async (file, displayName, index, total) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`${file.name} is larger than the 25 MB upload limit.`);
    }

    setUploadProgressLabel(`Preparing upload ${index} of ${total}: ${displayName}`);

    const presignResponse = await authenticatedFetch("/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "presign",
        originalFilename: file.name,
        displayName,
        contentType: file.type
      })
    });

    const presignData = await presignResponse.json();

    if (!presignResponse.ok) {
      throw new Error(presignData.message || `Failed to prepare upload for ${displayName}.`);
    }

    setUploadProgressLabel(`Uploading ${displayName} to S3...`);
    const uploadResponse = await fetch(presignData.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload ${displayName} to S3.`);
    }

    setUploadProgressLabel(`Saving metadata for ${displayName}...`);
    const completionResponse = await authenticatedFetch("/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "complete",
        fileId: presignData.fileId,
        displayName: presignData.displayName,
        originalFilename: presignData.originalFilename,
        s3Key: presignData.fileKey,
        uploadedAt: new Date().toISOString(),
        size: file.size,
        contentType: file.type || "application/octet-stream"
      })
    });

    const completionData = await completionResponse.json();

    if (!completionResponse.ok) {
      throw new Error(completionData.message || `Failed to save metadata for ${displayName}.`);
    }
  };

  const handleUploadBatch = async (entries) => {
    if (!entries.length) {
      return false;
    }

    setIsUploading(true);
    setError("");
    setMessage("");

    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const resolvedName = entry.displayName.trim() || entry.file.name;
        await uploadSingleFile(entry.file, resolvedName, index + 1, entries.length);
      }

      setUploadProgressLabel("");
      setFilters(defaultFilters);
      setMessage(
        entries.length === 1
          ? `Uploaded ${entries[0].displayName || entries[0].file.name} successfully.`
          : `Uploaded ${entries.length} files successfully.`
      );
      setDashboardRefreshToken((current) => current + 1);
      await fetchFiles();
      return true;
    } catch (uploadError) {
      setError(uploadError.message);
      return false;
    } finally {
      setIsUploading(false);
      setUploadProgressLabel("");
    }
  };

  const handleDelete = async (fileId, displayName, silent = false) => {
    setError("");
    setMessage("");
    setDeletingFile(fileId);

    try {
      const response = await authenticatedFetch("/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fileId })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to delete file.");
      }

      if (!silent) {
        setMessage(`Deleted ${displayName} successfully.`);
      }

      setDashboardRefreshToken((current) => current + 1);
    } finally {
      setDeletingFile("");
    }
  };

  const handleDeleteRequest = async (fileId, displayName) => {
    try {
      await handleDelete(fileId, displayName);

      if (hasActiveFilters(filters)) {
        await runSearch(filters);
      } else {
        await fetchFiles();
      }
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedFileIds.length) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedFileIds.length} selected file(s) from both Amazon S3 and DynamoDB?`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkDeleting(true);
    setError("");
    setMessage("");

    try {
      for (const fileId of selectedFileIds) {
        const file = files.find((item) => item.fileId === fileId);

        if (file) {
          await handleDelete(file.fileId, file.displayName, true);
        }
      }

      setSelectedFileIds([]);
      setMessage(`Deleted ${selectedFileIds.length} files successfully.`);

      if (hasActiveFilters(filters)) {
        await runSearch(filters);
      } else {
        await fetchFiles();
      }
    } catch (bulkDeleteError) {
      setError(bulkDeleteError.message);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleToggleSelect = (fileId) => {
    setSelectedFileIds((current) =>
      current.includes(fileId)
        ? current.filter((item) => item !== fileId)
        : [...current, fileId]
    );
  };

  const handleToggleSelectAll = () => {
    if (selectedFileIds.length === files.length) {
      setSelectedFileIds([]);
      return;
    }

    setSelectedFileIds(files.map((file) => file.fileId));
  };

  const handlePreview = async (file) => {
    void recordAccess(file.fileId);

    setPreviewState({
      file,
      textContent: "",
      isLoading: true,
      error: ""
    });

    const lowerName = file.originalFilename.toLowerCase();
    const isTextFile =
      textPreviewTypes.includes(file.contentType) ||
      [".txt", ".md", ".csv", ".json", ".xml", ".js", ".ts", ".log"].some((ext) =>
        lowerName.endsWith(ext)
      );

    if (!isTextFile) {
      setPreviewState({
        file,
        textContent: "",
        isLoading: false,
        error: ""
      });
      return;
    }

    try {
      const response = await fetch(file.downloadUrl);
      const textContent = await response.text();

      setPreviewState({
        file,
        textContent,
        isLoading: false,
        error: ""
      });
    } catch (previewError) {
      setPreviewState({
        file,
        textContent: "",
        isLoading: false,
        error: previewError.message
      });
    }
  };

  const handleDownload = (file) => {
    void recordAccess(file.fileId);
  };

  const handleClosePreview = () => {
    setPreviewState({
      file: null,
      textContent: "",
      isLoading: false,
      error: ""
    });
  };

  const handleAuthAction = async (action) => {
    setAuthError("");
    setIsAuthSubmitting(true);

    try {
      const nextSession = await action();

      if (nextSession?.token) {
        setSession(nextSession);
      }
    } catch (actionError) {
      setAuthError(actionError.message || "Authentication failed.");
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  if (isAuthLoading) {
    return <div className="auth-loading">Loading secure workspace...</div>;
  }

  if (!session) {
    return (
      <AuthPanel
        onSignIn={(payload) => handleAuthAction(() => signIn(payload))}
        onSignUp={(payload) => handleAuthAction(() => signUp(payload))}
        onConfirm={(payload) => handleAuthAction(() => confirmSignUp(payload))}
        error={authError}
        isSubmitting={isAuthSubmitting}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient-orb orb-left"></div>
      <div className="ambient-orb orb-right"></div>
      <div className="ambient-orb orb-bottom"></div>

      <nav className="top-nav">
        <div className="nav-brand">
          <span className="brand-primary">File</span>
          <span className="brand-secondary">Finder</span>
        </div>
        <div className="nav-links">
          <a href="#home">Home</a>
          <a href="#dashboard">Dashboard</a>
          <a href="#workspace">Workspace</a>
          <a href="#library">Library</a>
        </div>
        <div className="nav-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              signOut();
              setSession(null);
              setFiles([]);
            }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <main className="app-frame">
        <section id="home" className="hero hero-centered">
          <div className="hero-copy-block centered">
            <p className="eyebrow">Authenticated File Intelligence</p>
            <div className="hero-mark" aria-hidden="true">
              <span className="hero-mark-core" />
              <span className="hero-mark-node hero-mark-node-left" />
              <span className="hero-mark-node hero-mark-node-right" />
            </div>
            <h1>FileFinder</h1>
            <div className="hero-role">Smart Serverless File Workspace</div>
            <p className="hero-copy hero-copy-centered">
              Bulk upload, advanced filtering, file previews, dark mode, and authenticated
              access control in a polished workspace that still runs on your AWS serverless stack.
            </p>
            <div className="hero-actions hero-actions-centered">
              <button type="button" className="primary-button" onClick={fetchFiles}>
                Refresh Workspace
              </button>
              <a href="#workspace" className="secondary-button">
                Open Workspace
              </a>
            </div>
            <div className="hero-note">
              Signed in as <span>{session.name || session.email || session.username}</span>
            </div>
          </div>
        </section>

        <section className="overview-grid portfolio-grid">
          <article className="metric-card">
            <span className="metric-title">Files Indexed</span>
            <strong className="metric-value">{dashboardStats.totalFiles}</strong>
            <p>Everything uploaded in your private workspace.</p>
          </article>
          <article className="metric-card">
            <span className="metric-title">Tracked Storage</span>
            <strong className="metric-value">{dashboardStats.totalStorage}</strong>
            <p>Storage footprint based on indexed metadata.</p>
          </article>
          <article className="metric-card">
            <span className="metric-title">Active Filters</span>
            <strong className="metric-value">{activeFilterCount}</strong>
            <p>Smart search can filter by keyword, metadata, type, and upload time.</p>
          </article>
          <article className="metric-card">
            <span className="metric-title">Security Layers</span>
            <strong className="metric-value">JWT + ACL</strong>
            <p>Authenticated APIs, per-user access checks, validated input, and signed file URLs.</p>
          </article>
        </section>

        <Dashboard
          authenticatedFetch={authenticatedFetch}
          refreshToken={dashboardRefreshToken}
          formatDateTime={formatDateTime}
        />

        <section id="workspace" className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2 className="section-title">Upload, preview, and find what matters faster.</h2>
              <p className="section-copy">
                Queue multiple uploads, give each file a better name, and search documents
                by type, metadata, upload range, or general keywords.
              </p>
            </div>
          </div>

          <section className="panel-grid">
            <Upload
              onUpload={handleUploadBatch}
              isUploading={isUploading}
              uploadProgressLabel={uploadProgressLabel}
              maxFileSizeLabel={formatBytes(MAX_FILE_SIZE_BYTES)}
            />
            <Search
              filters={filters}
              onFiltersChange={handleFilterChange}
              onSearch={runSearch}
              onReset={async () => {
                setFilters(defaultFilters);
                await fetchFiles();
              }}
              isSearching={isSearching}
              activeFilterCount={activeFilterCount}
            />
          </section>
        </section>

        {(message || error) && (
          <div className={`status-banner ${error ? "error" : "success"}`}>
            {error || message}
          </div>
        )}

        <section id="library" className="content-section">
          <div className="section-heading section-heading-inline">
            <div>
              <p className="eyebrow">Library</p>
              <h2 className="section-title">Your private file collection.</h2>
              <p className="section-copy">
                Select multiple files for bulk delete, inspect metadata, and preview supported
                documents without leaving the workspace.
              </p>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={handleToggleSelectAll}
                disabled={!files.length}
              >
                {selectedFileIds.length === files.length && files.length ? "Clear Selection" : "Select All"}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleBulkDelete}
                disabled={!selectedFileIds.length || isBulkDeleting}
              >
                {isBulkDeleting ? "Deleting Selected..." : `Bulk Delete (${selectedFileIds.length})`}
              </button>
            </div>
          </div>

          <FileList
            files={files}
            isLoading={isLoading}
            onDelete={handleDeleteRequest}
            deletingFile={deletingFile}
            selectedFileIds={selectedFileIds}
            onToggleSelect={handleToggleSelect}
            activeFilterCount={activeFilterCount}
            formatBytes={formatBytes}
            formatDateTime={formatDateTime}
            onPreview={handlePreview}
            onDownload={handleDownload}
          />
        </section>
      </main>

      <PreviewModal
        previewState={previewState}
        onClose={handleClosePreview}
      />
    </div>
  );
}

export default App;
