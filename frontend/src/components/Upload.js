import { useState } from "react";

const MAX_DISPLAY_NAME_LENGTH = 160;

function Upload({ onUpload, isUploading, uploadProgressLabel, maxFileSizeLabel }) {
  const [entries, setEntries] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);

  const appendFiles = (fileList) => {
    const nextFiles = Array.from(fileList || []);

    if (!nextFiles.length) {
      return;
    }

    setEntries((current) => [
      ...current,
      ...nextFiles.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
        file,
        displayName: file.name
      }))
    ]);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    if (!entries.length) {
      return;
    }

    const wasSuccessful = await onUpload(entries);

    if (wasSuccessful) {
      setEntries([]);
      form.reset();
    }
  };

  return (
    <section className="panel panel-highlight">
      <h2>Bulk Upload</h2>
      <p className="panel-copy">
        Drop one or many files into the queue, then rename each file before secure upload.
      </p>

      <form onSubmit={handleSubmit} className="stack">
        <label
          className={`file-picker ${isDragActive ? "drag-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragActive(false);
            appendFiles(event.dataTransfer.files);
          }}
        >
          <div className="upload-visual">+</div>
          <div className="upload-copy">
            <strong>{entries.length ? `${entries.length} file(s) queued` : "Drag and drop files"}</strong>
            <span>
              {entries.length
                ? "Review each display name below before uploading."
                : `or click to browse. Maximum size ${maxFileSizeLabel} per file.`}
            </span>
          </div>
          <input
            type="file"
            multiple
            onChange={(event) => appendFiles(event.target.files)}
          />
        </label>

        {entries.length > 0 && (
          <div className="upload-queue">
            {entries.map((entry) => (
              <div className="queue-row" key={entry.id}>
                <div className="queue-file">
                  <strong>{entry.file.name}</strong>
                  <span>
                    {(entry.file.type || "Unknown type").replace("/", " / ")} •{" "}
                    {Math.max(entry.file.size / 1024, 1).toFixed(1)} KB
                  </span>
                </div>
                <input
                  className="text-input"
                  type="text"
                  value={entry.displayName}
                  onChange={(event) =>
                    setEntries((current) =>
                      current.map((item) =>
                        item.id === entry.id
                          ? {
                              ...item,
                              displayName: event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH)
                            }
                          : item
                      )
                    )
                  }
                  maxLength={MAX_DISPLAY_NAME_LENGTH}
                />
              </div>
            ))}
          </div>
        )}

        {uploadProgressLabel && <div className="inline-status">{uploadProgressLabel}</div>}

        <div className="button-row">
          <button type="submit" className="primary-button" disabled={!entries.length || isUploading}>
            {isUploading ? "Uploading Queue..." : `Upload ${entries.length || ""}`.trim()}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!entries.length || isUploading}
            onClick={() => setEntries([])}
          >
            Clear Queue
          </button>
        </div>
      </form>
    </section>
  );
}

export default Upload;
