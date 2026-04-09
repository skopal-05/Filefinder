function FileList({
  files,
  isLoading,
  onDelete,
  deletingFile,
  selectedFileIds,
  onToggleSelect,
  activeFilterCount,
  formatBytes,
  formatDateTime,
  onPreview,
  onDownload
}) {
  const confirmDelete = (fileId, displayName) => {
    const confirmed = window.confirm(
      `Delete "${displayName}" from both Amazon S3 and DynamoDB?`
    );

    if (confirmed) {
      onDelete(fileId, displayName);
    }
  };

  return (
    <section className="panel file-panel">
      <div className="file-panel-header">
        <div>
          <h2>Uploaded Files</h2>
          <p className="panel-copy">
            Preview supported files, inspect metadata, and take action on individual or bulk selections.
          </p>
        </div>
        <span className="file-count">{files.length} items</span>
      </div>

      {activeFilterCount > 0 && (
        <div className="results-bar">
          Showing filtered results using <strong>{activeFilterCount}</strong> active filter(s)
        </div>
      )}

      {isLoading ? (
        <div className="empty-state">Loading files...</div>
      ) : files.length === 0 ? (
        <div className="empty-state">No files found.</div>
      ) : (
        <div className="file-list">
          {files.map((file) => (
            <article className="file-row" key={file.fileId}>
              <label className="select-pill">
                <input
                  type="checkbox"
                  checked={selectedFileIds.includes(file.fileId)}
                  onChange={() => onToggleSelect(file.fileId)}
                />
                <span>Select</span>
              </label>

              <div className="file-main">
                <div className="file-avatar">{file.displayName.slice(0, 1).toUpperCase()}</div>
                <div className="file-details">
                  <div className="file-heading-row">
                    <h3>{file.displayName}</h3>
                    {file.size ? <span className="file-pill">{formatBytes(file.size)}</span> : null}
                    <span className="file-pill file-pill-type">{file.contentType || "unknown"}</span>
                  </div>
                  <p>Original file: {file.originalFilename}</p>
                  <p>Uploaded {formatDateTime(file.uploadedAt)}</p>
                  <p className="file-key">Key: {file.s3Key}</p>
                </div>
              </div>

              <div className="button-row file-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onPreview(file)}
                >
                  Preview
                </button>
                <a
                  className="secondary-button"
                  href={file.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onDownload(file)}
                >
                  Download
                </a>
                <button
                  type="button"
                  className="danger-button"
                  disabled={deletingFile === file.fileId}
                  onClick={() => confirmDelete(file.fileId, file.displayName)}
                >
                  {deletingFile === file.fileId ? "Deleting..." : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default FileList;
