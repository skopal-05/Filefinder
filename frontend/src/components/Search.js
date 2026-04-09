function Search({
  filters,
  onFiltersChange,
  onSearch,
  onReset,
  isSearching,
  activeFilterCount
}) {
  const updateField = (field, value) => {
    onFiltersChange((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSearch(filters);
  };

  return (
    <section className="panel">
      <h2>Search</h2>
      <p className="panel-copy">
        Search with natural language across file names, tags, descriptions, type, and upload date.
      </p>

      <form onSubmit={handleSubmit} className="stack">
        <input
          type="text"
          className="text-input"
          placeholder='Try "show my internship certificates" or "find DBMS notes"'
          value={filters.query}
          onChange={(event) => updateField("query", event.target.value)}
          maxLength={120}
        />

        <input
          type="text"
          className="text-input"
          placeholder="Optional metadata filter"
          value={filters.metadata}
          onChange={(event) => updateField("metadata", event.target.value)}
          maxLength={120}
        />

        <div className="filter-grid">
          <select
            className="text-input"
            value={filters.fileType}
            onChange={(event) => updateField("fileType", event.target.value)}
          >
            <option value="">All types</option>
            <option value="pdf">PDF</option>
            <option value="text">TXT / text</option>
            <option value="word">Word</option>
            <option value="image">Image</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>

          <input
            type="date"
            className="text-input"
            value={filters.dateFrom}
            onChange={(event) => updateField("dateFrom", event.target.value)}
            aria-label="Search from date"
          />

          <input
            type="date"
            className="text-input"
            value={filters.dateTo}
            onChange={(event) => updateField("dateTo", event.target.value)}
            aria-label="Search to date"
          />
        </div>

        <div className="button-row">
          <button type="submit" className="primary-button search-button">
            {isSearching ? "Searching..." : "Run Search"}
          </button>
          <button type="button" className="secondary-button" onClick={onReset}>
            Reset Filters
          </button>
          <span className="search-chip">{activeFilterCount} active filter(s)</span>
        </div>
      </form>
    </section>
  );
}

export default Search;
