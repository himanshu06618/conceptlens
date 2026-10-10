import React from 'react';

/**
 * BookshelfLoader Component
 * Pure CSS line-art looping domino bookshelf motion animation.
 * Books topple towards the left one after another in a seamless domino wave,
 * resting on a clean horizontal shelf line with a dotted shadow.
 *
 * No blue background box, no author text — just the pure bookshelf motion loader.
 */
export default function BookshelfLoader({
  size = 'md',
  label = '',
  className = '',
  style = {},
  ...props
}) {
  const scale = size === 'sm' ? 0.2 : size === 'lg' ? 1.15 : 1;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label || 'Loading content...'}
      className={`bookshelf-motion-loader ${className}`.trim()}
      style={{
        '--bookshelf-scale': scale,
        '--bookshelf-stage-width': `${290 * scale}px`,
        '--bookshelf-stage-height': `${124 * scale}px`,
        ...style
      }}
      {...props}
    >
      <div className="bookshelf-motion-stage-wrap" aria-hidden="true">
        <div className="bookshelf-motion-stage">
          {/* The 6 Domino Books */}
          <div className="books-motion-layer">
            {/* Book 0: Tips flat (-90deg), slides left & fades out */}
            <div className="domino-book book-pos-0">
              <div className="book-spine-line spine-top-1" />
              <div className="book-spine-line spine-top-2" />
              <div className="book-spine-line spine-bot-1" />
              <div className="book-spine-line spine-bot-2" />
            </div>

            {/* Book 1: Starting at -50deg */}
            <div className="domino-book book-pos-1">
              <div className="book-spine-line spine-top-1" />
              <div className="book-spine-dot spine-dot-bot" />
            </div>

            {/* Book 2: Starting at -35deg */}
            <div className="domino-book book-pos-2">
              <div className="book-spine-line spine-top-1" />
              <div className="book-spine-line spine-mid-1" />
              <div className="book-spine-line spine-bot-1" />
            </div>

            {/* Book 3: Starting at -20deg */}
            <div className="domino-book book-pos-3">
              <div className="book-spine-line spine-top-1" />
              <div className="book-spine-line spine-top-2" />
              <div className="book-spine-dot spine-dot-bot" />
            </div>

            {/* Book 4: Starting upright (0deg) */}
            <div className="domino-book book-pos-4">
              <div className="book-spine-dot spine-dot-top" />
              <div className="book-spine-line spine-bot-1" />
              <div className="book-spine-line spine-bot-2" />
            </div>

            {/* Book 5: Incoming upright book (fades in at 0deg) */}
            <div className="domino-book book-pos-5">
              <div className="book-spine-line spine-top-1" />
              <div className="book-spine-line spine-top-2" />
              <div className="book-spine-line spine-bot-1" />
              <div className="book-spine-line spine-bot-2" />
            </div>
          </div>

          {/* Shelf Line (280px wide, 3px thick) */}
          <div className="motion-shelf-line" />

          {/* Dotted Shadow Directly Below the Shelf Line */}
          <div className="motion-shelf-dots" />
        </div>
      </div>

      {label && size !== 'sm' && (
        <span className="bookshelf-motion-label">{label}</span>
      )}
    </div>
  );
}
