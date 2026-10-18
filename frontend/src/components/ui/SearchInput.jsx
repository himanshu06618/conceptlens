import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Standardized SearchInput — "Flux" Design System
 * Pill-shaped search bar (radius 9999px) with search icon, clear button, and lime focus ring.
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
    <div className={`flux-search-input-wrapper ${className}`.trim()}>
      <Search size={18} strokeWidth={2} className="flux-search-icon" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="flux-search-field"
        aria-label="Search"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="flux-search-clear-btn"
          aria-label="Clear search query"
        >
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
});

export default SearchInput;
