import React, { useState, useEffect } from 'react';
import { Navbar } from './Navbar';
import { api } from '../api';

export function Dashboard({ user, onLogout, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exportedJson, setExportedJson] = useState(null);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

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

  const handleInspectData = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const data = await api.exportUserData(false);
      setExportedJson(data);
      setShowJsonModal(true);
    } catch (err) {
      console.error('Fetch data failed:', err);
      setExportError(err.message || 'Failed to retrieve user data for preview.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyJson = async () => {
    if (!exportedJson) return;
    try {
      const str = JSON.stringify(exportedJson, null, 2);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(str);
      } else {
        const ta = document.createElement('textarea');
        ta.value = str;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2500);
    } catch (err) {
      console.error('Copy failed:', err);
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="yt-nav-btn yt-nav-btn-secondary"
                  onClick={handleInspectData}
                  disabled={isExporting}
                  style={{
                    padding: '10px 18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>👁️ View JSON Data</span>
                </button>

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
                      <span>📥 Download JSON File</span>
                    </>
                  )}
                </button>
              </div>
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

          {/* JSON Export Viewer Modal */}
          {showJsonModal && exportedJson && (
            <div className="yt-modal-backdrop" onClick={() => setShowJsonModal(false)}>
              <div
                className="yt-modal-content"
                onClick={(e) => e.stopPropagation()}
                style={{
                  maxWidth: '820px',
                  width: '95%',
                  maxHeight: '85vh',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: '#121212',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '12px',
                  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.95)',
                }}
              >
                <div
                  className="yt-modal-header"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '17px', fontWeight: '700', color: '#fff', margin: 0 }}>
                      User Music Collection Export (JSON)
                    </h3>
                    <p style={{ fontSize: '12px', color: '#aaa', margin: '4px 0 0' }}>
                      {exportedJson.stats?.total_songs || 0} tracks • {exportedJson.stats?.total_folders || 0} playlists • {exportedJson.stats?.total_favorites || 0} favorites
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="yt-nav-btn yt-nav-btn-secondary"
                      onClick={handleCopyJson}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      {copiedJson ? '✓ Copied!' : '📋 Copy JSON'}
                    </button>
                    <button
                      type="button"
                      className="yt-nav-btn yt-nav-btn-primary"
                      onClick={handleExportData}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      📥 Download File
                    </button>
                    <button
                      type="button"
                      className="yt-modal-close"
                      onClick={() => setShowJsonModal(false)}
                      style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
                  <pre
                    style={{
                      background: '#050505',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '16px',
                      color: '#4ade80',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      overflowX: 'auto',
                      maxHeight: '55vh',
                      margin: 0,
                      fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(exportedJson, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
