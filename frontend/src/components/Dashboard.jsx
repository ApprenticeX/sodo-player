import React, { useState, useEffect } from 'react';
import { Navbar } from './Navbar';
import { api } from '../api';

export function Dashboard({ user, onLogout, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    let ignore = false;
    async function loadStats() {
      try {
        const data = await api.getUserStats();
        if (!ignore) {
          setStats(data);
        }
      } catch (err) {
        console.warn('Failed to load user statistics:', err);
      }
    }
    loadStats();
    return () => {
      ignore = true;
    };
  }, []);

  const handleExportData = async () => {
    setIsExporting(true);
    setExportMessage(null);
    setExportError(null);
    try {
      const res = await api.exportUserData(true);
      setExportMessage(`✓ Successfully downloaded: ${res.filename || 'music backup'}`);
      setTimeout(() => setExportMessage(null), 4000);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(err.message || 'Failed to download library backup.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="ytm-app-layout">
      {/* Top Navbar */}
      <Navbar
        currentPage="dashboard"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        searchPlaceholder="Search songs, albums, artists..."
      />

      {/* Main Content Area */}
      <main className="ytm-main-content">
        <section className="ytm-home-section" style={{ maxWidth: '960px', margin: '0 auto', width: '100%' }}>
          <div className="ytm-section-header-row" style={{ marginBottom: '24px' }}>
            <div>
              <span className="ytm-section-eyebrow">ACCOUNT & SYSTEM</span>
              <h1 className="ytm-section-main-title">Account Profile</h1>
            </div>
          </div>

          <div className="ytm-account-hero-card">
            <div className="ytm-account-avatar-large">
              {(user.full_name || user.username).slice(0, 2).toUpperCase()}
            </div>
            <div className="ytm-account-info-col">
              <h2 className="ytm-account-name">{user.full_name || user.username}</h2>
              <p className="ytm-account-email">{user.email}</p>
              <div className="ytm-account-pill-row">
                <span className="ytm-chip-status">● Session Active</span>
                <span className="ytm-chip-id">User #{user.id}</span>
                {user.created_at && (
                  <span className="ytm-chip-meta">Joined {new Date(user.created_at).toLocaleDateString()}</span>
                )}
                {stats && (
                  <>
                    <span className="ytm-chip-meta">📁 {stats.total_folders} Folders</span>
                    <span className="ytm-chip-meta">🎵 {stats.total_songs} Tracks</span>
                    <span className="ytm-chip-meta">⭐ {stats.total_favorites} Favorites</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Navigation & Action Cards Grid */}
          <div className="ytm-dashboard-cards-grid">
            <div className="ytm-metric-card" onClick={() => onNavigate('home')} style={{ cursor: 'pointer' }}>
              <div className="ytm-metric-icon">🎵</div>
              <div className="ytm-metric-title">Music Library</div>
              <div className="ytm-metric-desc">
                Browse your saved tracks and play smart queues
                {stats ? ` (${stats.total_songs} songs)` : ''}
              </div>
              <button type="button" className="ytm-btn-pill-small" style={{ marginTop: '12px' }}>
                Open Home
              </button>
            </div>

            <div className="ytm-metric-card" onClick={() => onNavigate('playlists')} style={{ cursor: 'pointer' }}>
              <div className="ytm-metric-icon">📁</div>
              <div className="ytm-metric-title">Hierarchical Playlists</div>
              <div className="ytm-metric-desc">
                Organize songs into nested subfolders and tree maps
                {stats ? ` (${stats.total_folders} folders)` : ''}
              </div>
              <button type="button" className="ytm-btn-pill-small" style={{ marginTop: '12px' }}>
                Open Playlists
              </button>
            </div>

            <div className="ytm-metric-card" onClick={() => onNavigate('yt-search')} style={{ cursor: 'pointer' }}>
              <div className="ytm-metric-icon">▶</div>
              <div className="ytm-metric-title">Explore YouTube</div>
              <div className="ytm-metric-desc">Search millions of songs, discover music, and save to playlists</div>
              <button type="button" className="ytm-btn-pill-small" style={{ marginTop: '12px' }}>
                Explore Now
              </button>
            </div>

            <div className="ytm-metric-card">
              <div className="ytm-metric-icon">🔒</div>
              <div className="ytm-metric-title">Security & Session</div>
              <div className="ytm-metric-desc">Secured via JSON Web Tokens (JWT) and bcrypt hashing</div>
              <button
                type="button"
                className="ytm-btn-pill-ghost danger"
                onClick={onLogout}
                style={{ marginTop: '12px' }}
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Data Export & Backup Card */}
          <div
            className="ytm-metric-card"
            style={{
              marginTop: '24px',
              padding: '24px',
              border: '1px solid var(--border-medium)',
              backgroundColor: 'var(--bg-card)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>💾</span>
                  <h3 style={{ fontSize: '17px', fontWeight: '700', color: 'var(--text-primary)' }}>
                    Export & Backup Music Collection
                  </h3>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '640px' }}>
                  Download a structured JSON export of your personal music library, nested playlists, track metadata,
                  and YouTube links. Perfect for local backups and data portability.
                </p>
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={handleExportData}
                disabled={isExporting}
                style={{
                  width: 'auto',
                  padding: '10px 22px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {isExporting ? (
                  <>
                    <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                    <span>Preparing Backup...</span>
                  </>
                ) : (
                  <>
                    <span>📥 Download JSON Backup</span>
                  </>
                )}
              </button>
            </div>

            {exportMessage && (
              <div className="alert alert-success" style={{ marginTop: '16px', marginBottom: 0 }}>
                {exportMessage}
              </div>
            )}

            {exportError && (
              <div className="alert alert-danger" style={{ marginTop: '16px', marginBottom: 0 }}>
                {exportError}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
