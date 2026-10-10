import React from 'react';
import BookshelfLoader from '../ui/BookshelfLoader';

/**
 * Dev-only showcase for testing BookshelfLoader sizes
 * in light and dark mode. Not linked in main production navigation.
 */
export default function LoaderShowcase() {
  return (
    <div style={{ padding: 40, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <h2>Bookshelf Loader Showcase (Dev Only)</h2>

      {/* Section 1: Size LG (Upload & Processing) */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
        <h3>Size: Large (lg)</h3>
        <BookshelfLoader size="lg" label="Reading your notes..." />
      </div>

      {/* Section 2: Size MD (View / Stage Fallback) */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
        <h3>Size: Medium (md)</h3>
        <BookshelfLoader size="md" label="Assembling concept hierarchy..." />
      </div>

      {/* Section 3: Size SM (Inline / Button) */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
        <h3>Size: Small (sm) - Inline in Buttons</h3>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--gold)', color: '#000', borderRadius: 8, border: 'none' }}>
            <BookshelfLoader size="sm" />
            <span>Signing in...</span>
          </button>

          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <BookshelfLoader size="sm" />
            <span>Exporting CSV...</span>
          </button>
        </div>
      </div>
    </div>
  );
}
