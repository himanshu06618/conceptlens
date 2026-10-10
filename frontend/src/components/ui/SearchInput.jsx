import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Clean Glassmorphic SearchInput
 * Visible border, focus ring, search icon prefix, clear button.
 */
const SearchInput = forwardRef(function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search concepts, terms, or definitions...',
  className = '',
  ...props
}, ref) {
  return (
    <div className={`search-input-wrapper ${className}`.trim()}>
      <Search size={18} strokeWidth={1.75} className="search-icon" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="search-field"
        aria-label="Search concepts"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="search-clear-btn"
          aria-label="Clear search query"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
});

export default SearchInput;
