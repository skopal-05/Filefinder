function PreviewModal({ previewState, onClose }) {
  const { file, textContent, isLoading, error } = previewState;

  if (!file) {
    return null;
  }

  const isImage = file.contentType.startsWith("image/");
  const isPdf = file.contentType.includes("pdf");
  const isText = Boolean(textContent);

  return (
    <div className="preview-backdrop" role="presentation" onClick={onClose}>
      <div className="preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="preview-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>{file.displayName}</h2>
            <p className="panel-copy">{file.originalFilename}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="preview-body">
          {isLoading ? <div className="empty-state">Loading preview...</div> : null}
          {!isLoading && error ? <div className="status-banner error">{error}</div> : null}
          {!isLoading && !error && isImage ? (
            <img className="preview-image" src={file.downloadUrl} alt={file.displayName} />
          ) : null}
          {!isLoading && !error && isPdf ? (
            <iframe className="preview-frame" src={file.downloadUrl} title={file.displayName} />
          ) : null}
          {!isLoading && !error && isText ? (
            <pre className="preview-text">{textContent}</pre>
          ) : null}
          {!isLoading && !error && !isImage && !isPdf && !isText ? (
            <div className="empty-state">
              Preview is not available for this file type yet. Use download to inspect it locally.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default PreviewModal;
