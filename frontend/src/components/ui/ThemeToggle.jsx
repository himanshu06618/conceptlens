import React from 'react';
import { Sun, Moon } from 'lucide-react';

/**
 * ThemeToggle
 * Simple sun/moon icon button with smooth 200ms crossfade transition.
 */
export default function ThemeToggle({ theme, onToggle, className = '' }) {
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle-btn ${className}`.trim()}
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <div className="theme-toggle-icon-wrap">
        <Sun 
          size={20} 
          strokeWidth={1.75} 
          className={`theme-icon sun-icon ${!isDark ? 'active' : ''}`} 
        />
        <Moon 
          size={20} 
          strokeWidth={1.75} 
          className={`theme-icon moon-icon ${isDark ? 'active' : ''}`} 
        />
      </div>
    </button>
  );
}
