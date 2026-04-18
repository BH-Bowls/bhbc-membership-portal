// components/SearchableSelect.tsx
// Searchable dropdown component with filtering (like Google Sheets autocomplete)

import { useState, useRef, useEffect } from 'react';

interface SelectOption {
  value: string;
  label: string;
  /** If true the option renders with strikethrough and cannot be selected */
  strikethrough?: boolean;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  keepFocusOnSelect?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  className = '',
  disabled = false,
  autoFocus = false,
  keepFocusOnSelect = false,
}: SearchableSelectProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount if requested
  useEffect(() => {
    if (autoFocus && inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled]);

  // Filter options based on search term
  // Google Sheets-style matching: check if any word in the label starts with the search term
  // Example: typing "app" matches "Daniel Appleton" because "Appleton" starts with "app"
  // Multi-word search: "Paul B" matches "Paul Bloggs" because "Paul" starts with "paul" and "Bloggs" starts with "b"
  const filteredOptions = options.filter(option => {
    if (!searchTerm) return true;

    const searchLower = searchTerm.toLowerCase().trim();
    const labelLower = option.label.toLowerCase();

    // Split both search term and label into words
    const searchWords = searchLower.split(/\s+/).filter(w => w.length > 0);
    const labelWords = labelLower.split(/\s+/);

    // Check if all search words match the start of some label word
    return searchWords.every(searchWord =>
      labelWords.some(labelWord => labelWord.startsWith(searchWord))
    );
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle input change
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    const newValue = e.target.value;
    setSearchTerm(newValue);
    setIsOpen(true);
    setHighlightedIndex(0);
  }

  // Handle option selection
  function handleSelect(option: SelectOption) {
    if (disabled || option.strikethrough) return;
    onChange(option.value);
    setSearchTerm('');
    setIsOpen(false); // Always close dropdown after selection
    if (keepFocusOnSelect) {
      // Keep focus on input for quick additional selections
      // User can start typing again to reopen dropdown
      inputRef.current?.focus();
    } else {
      inputRef.current?.blur();
    }
  }

  // Handle keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex] && !filteredOptions[highlightedIndex].strikethrough) {
          handleSelect(filteredOptions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearchTerm('');
        break;
    }
  }

  // Get display value (show selected option's label or search term)
  const displayValue = value
    ? options.find(opt => opt.value === value)?.label || ''
    : searchTerm;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? searchTerm : displayValue}
        onChange={handleInputChange}
        onFocus={() => {
          if (!disabled) {
            // Don't open dropdown on focus - only open when user starts typing
            setSearchTerm('');
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-4 py-3 text-base text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
      />

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">No matches found</div>
          ) : (
            filteredOptions.map((option, index) => (
              <div
                key={option.value}
                onClick={() => handleSelect(option)}
                className={`px-3 py-2 text-sm ${
                  option.strikethrough
                    ? 'text-gray-400 cursor-default line-through'
                    : index === highlightedIndex
                      ? 'bg-blue-100 text-blue-900 cursor-pointer'
                      : 'text-gray-900 hover:bg-gray-100 cursor-pointer'
                }`}
              >
                {option.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
