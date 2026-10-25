import React, { useState } from 'react';

/**
 * Authentic YouTube Music Navbar Component
 * Features:
 * - Real YouTube Music branding (red play badge + bold 'Music')
 * - Centered pill-shaped search bar
 * - Navigation links (Home, Library / Playlists, YT Search)
 * - User avatar & profile actions
 */
export function Navbar({
  currentPage = 'home',
  onNavigate,
  user,
  onLogout,
  searchValue = '',
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = 'Search songs, albums, artists...',
}) {
  const [prevSearchValue, setPrevSearchValue] = useState(searchValue);
  const [localSearch, setLocalSearch] = useState(searchValue);

  // Sync local search when prop changes
  if (searchValue !== prevSearchValue) {
    setPrevSearchValue(searchValue);
    setLocalSearch(searchValue);
  }

  const handleInputChange = (e) => {
    const val = e.target.value;
    setLocalSearch(val);
    if (onSearchChange) {
      onSearchChange(val);
    }
  };

  const handleClear = () => {
    setLocalSearch('');
    if (onSearchChange) {
      onSearchChange('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSearchSubmit) {
      onSearchSubmit(localSearch);
    } else if (localSearch.trim()) {
      // Default fallback: navigate to YT search with query
      const clean = localSearch.trim();
      const newUrl = new URL(window.location.href);
      newUrl.pathname = '/yt-search';
      newUrl.searchParams.set('q', clean);
      window.history.pushState({ q: clean }, '', newUrl.toString());
      if (onNavigate) onNavigate('yt-search');
    }
  };

  const userInitials = user
    ? (user.full_name
        ? user.full_name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : user.username.slice(0, 2).toUpperCase())
    : '';

  return (
    <header className="ytm-header-navbar">
      {/* Brand / Logo */}
      <div className="ytm-brand" onClick={() => onNavigate && onNavigate('home')}>
        <div className="ytm-logo-badge" title="Sodo Music">
          <svg width="26" height="26" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#ff0000" />
            <circle cx="12" cy="12" r="6" fill="none" stroke="#ffffff" strokeWidth="1.2" />
            <polygon points="10 8 16 12 10 16" fill="#ffffff" />
          </svg>
        </div>
        <div className="ytm-brand-text">
          <span className="ytm-brand-name">Sodo</span>
          <span className="ytm-brand-music">Music</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="ytm-nav-group">
        <button
          type="button"
          className={`ytm-nav-link ${currentPage === 'home' ? 'active' : ''}`}
          onClick={() => onNavigate && onNavigate('home')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
          <span>Home</span>
        </button>

        <button
          type="button"
          className={`ytm-nav-link ${currentPage === 'playlists' ? 'active' : ''}`}
          onClick={() => onNavigate && onNavigate('playlists')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Library</span>
        </button>

        <button
          type="button"
          className={`ytm-nav-link ${currentPage === 'yt-search' ? 'active' : ''}`}
          onClick={() => onNavigate && onNavigate('yt-search')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Explore</span>
        </button>
      </nav>

      {/* Center Pill Search Bar */}
      <form className="ytm-search-pill-form" onSubmit={handleSubmit}>
        <div className="ytm-search-pill-inner">
          <svg className="ytm-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="ytm-search-pill-input"
            placeholder={searchPlaceholder}
            value={localSearch}
            onChange={handleInputChange}
            autoComplete="off"
          />
          {localSearch && (
            <button
              type="button"
              className="ytm-search-pill-clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </form>

      {/* User Actions */}
      <div className="ytm-user-zone">
        {user ? (
          <>
            <button
              type="button"
              className={`ytm-btn-ghost ${currentPage === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate && onNavigate('dashboard')}
              title="Dashboard"
            >
              <span>Dashboard</span>
            </button>

            <div
              className="ytm-user-circle"
              onClick={() => onNavigate && onNavigate('dashboard')}
              title={`Logged in as ${user.full_name || user.username}`}
            >
              {userInitials}
            </div>

            <button
              type="button"
              className="ytm-icon-action-btn"
              onClick={onLogout}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ytm-sign-in-btn"
            onClick={() => onNavigate && onNavigate('login')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
