import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { FolderTreeVisualizer } from './FolderTreeVisualizer';
import { usePlayer } from '../context/PlayerContext';
import { Navbar } from './Navbar';

export function PlaylistsPage({ user, onNavigate, onLogout }) {
  const [currentPath, setCurrentPath] = useState('ALL');
  const [folderData, setFolderData] = useState({
    path: 'ALL',
    path_tags: ['ALL'],
    subfolders: [],
    videos: [],
    total_videos: 0,
  });
  const [allTreeFolders, setAllTreeFolders] = useState([]);
  const [totalLibrarySongs, setTotalLibrarySongs] = useState(0);
  const [favoriteLibrarySongs, setFavoriteLibrarySongs] = useState(0);

  // View Mode: 'cards' | 'tree'
  const [viewMode, setViewMode] = useState('cards');
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modals
  const [addToPlaylistVideo, setAddToPlaylistVideo] = useState(null);
  const [isCreatingSubfolder, setIsCreatingSubfolder] = useState(false);
  const [newSubfolderInput, setNewSubfolderInput] = useState('');

  // Toast
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

  const { playTrack, playVideo, playPlaylist, currentTrack, isPlaying } = usePlayer();

  const showToast = (msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2800);
  };

  const copyToClipboard = async (text, label = 'Link') => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      showToast(`${label} copied to clipboard!`);
    } catch {
      showToast(`Copied: ${text}`);
    }
  };

  // Fetch full folder tree
  const loadFullTree = async () => {
    try {
      const treeRes = await api.getFolderTree();
      setAllTreeFolders(treeRes.folders || []);
      setTotalLibrarySongs(treeRes.total_songs || 0);
      setFavoriteLibrarySongs(treeRes.favorite_songs || 0);
    } catch (err) {
      console.warn('Failed to load tree metadata:', err);
    }
  };

  // Fetch current folder contents
  const loadFolder = async (path, query = '') => {
    setIsLoading(true);
    try {
      const data = await api.getFolderContents(path, query);
      setFolderData(data);
      setCurrentPath(path);
    } catch (err) {
      console.error('Failed to load folder:', err);
      setError(err.message || 'Unable to load playlist folder.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    async function fetchTree() {
      if (!user && !api.getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const treeRes = await api.getFolderTree();
        if (!ignore) {
          setAllTreeFolders(treeRes.folders || []);
          setTotalLibrarySongs(treeRes.total_songs || 0);
          setFavoriteLibrarySongs(treeRes.favorite_songs || 0);
        }
      } catch (err) {
        console.warn('Failed to load tree metadata:', err);
      }
    }
    fetchTree();
    return () => {
      ignore = true;
    };
  }, [user]);

  useEffect(() => {
    let ignore = false;
    async function fetchFolder() {
      if (!user && !api.getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const data = await api.getFolderContents(currentPath, searchFilter);
        if (!ignore) {
          setFolderData(data);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Failed to load folder:', err);
          if (err.status === 401) {
            setError('Please sign in to access your playlists.');
          } else {
            setError(err.message || 'Unable to load playlist folder.');
          }
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    fetchFolder();
    return () => {
      ignore = true;
    };
  }, [currentPath, searchFilter, user]);

  const handleSearchFilterChange = (val) => {
    setSearchFilter(val);
  };

  const handleBreadcrumbClick = (targetPath) => {
    setSearchFilter('');
    setCurrentPath(targetPath);
  };

  const handlePlayCurrentFolder = () => {
    if (folderData.videos && folderData.videos.length > 0) {
      playPlaylist(currentPath, folderData.videos, 0);
      showToast(`▶ Playing ${folderData.videos.length} tracks in "${currentPath}"`);
    } else {
      showToast(`No songs in "${currentPath}" to play.`);
    }
  };

  const handlePlaySpecificFolder = async (targetPath) => {
    try {
      const data = await api.getFolderContents(targetPath);
      if (data.videos && data.videos.length > 0) {
        playPlaylist(targetPath, data.videos, 0);
        showToast(`▶ Playing ${data.videos.length} tracks in "${targetPath}"`);
      } else {
        showToast(`No tracks found in "${targetPath}".`);
      }
    } catch (err) {
      console.error('Error playing folder:', err);
      showToast('Could not load songs for folder.');
    }
  };

  const handleCreateSubfolder = async (e) => {
    e.preventDefault();
    const clean = newSubfolderInput.trim().replace(/^\/+|\/+$/g, '').toUpperCase();
    if (!clean) return;

    let fullPath = clean;
    if (currentPath !== 'ALL' && currentPath !== 'FAVORITES') {
      fullPath = `${currentPath}/${clean}`;
    }

    try {
      await api.createFolder(fullPath);
      showToast(`Created subfolder "${fullPath}"`);
      setIsCreatingSubfolder(false);
      setNewSubfolderInput('');
      loadFolder(currentPath);
      loadFullTree();
    } catch (err) {
      console.error('Error creating subfolder:', err);
      showToast('Failed to create subfolder');
    }
  };

  const handleDeleteFolder = async () => {
    if (currentPath === 'ALL' || currentPath === 'FAVORITES') return;
    if (!window.confirm(`Are you sure you want to delete folder "${currentPath}" and all its subfolders?`)) {
      return;
    }

    try {
      await api.deleteFolder(currentPath, true);
      showToast(`Deleted folder "${currentPath}"`);
      const parts = currentPath.split('/');
      parts.pop();
      const parentPath = parts.join('/') || 'ALL';
      setCurrentPath(parentPath);
      loadFullTree();
    } catch (err) {
      console.error('Failed to delete folder:', err);
      showToast('Failed to delete folder');
    }
  };

  const handleToggleFavorite = async (itemId) => {
    try {
      const res = await api.toggleFavoritePlaylistItem(itemId);
      showToast(res.is_favorite ? '⭐ Marked as Favorite' : 'Unfavorited');
      loadFolder(currentPath, searchFilter);
      loadFullTree();
    } catch (err) {
      console.error('Toggle favorite err:', err);
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await api.removePlaylistItem(itemId);
      showToast('Removed song from playlist');
      loadFolder(currentPath, searchFilter);
      loadFullTree();
    } catch (err) {
      console.error('Remove item err:', err);
      showToast('Failed to remove item');
    }
  };

  // Build breadcrumb segments
  const renderBreadcrumbs = () => {
    if (currentPath === 'ALL') {
      return <span className="ytm-crumb-active">🌐 ALL (Root)</span>;
    }
    if (currentPath === 'FAVORITES') {
      return (
        <>
          <button type="button" className="ytm-crumb-link" onClick={() => handleBreadcrumbClick('ALL')}>
            🌐 ALL
          </button>
          <span className="ytm-crumb-sep">/</span>
          <span className="ytm-crumb-active">⭐ FAVORITES</span>
        </>
      );
    }

    const segments = currentPath.split('/');
    const crumbs = [
      <button key="all" type="button" className="ytm-crumb-link" onClick={() => handleBreadcrumbClick('ALL')}>
        🌐 ALL
      </button>,
    ];

    let accum = '';
    segments.forEach((seg, index) => {
      accum = accum ? `${accum}/${seg}` : seg;
      const stepPath = accum;
      const isLast = index === segments.length - 1;

      crumbs.push(<span key={`sep-${index}`} className="ytm-crumb-sep">/</span>);
      if (isLast) {
        crumbs.push(<span key={stepPath} className="ytm-crumb-active">📂 {seg}</span>);
      } else {
        crumbs.push(
          <button
            key={stepPath}
            type="button"
            className="ytm-crumb-link"
            onClick={() => handleBreadcrumbClick(stepPath)}
          >
            {seg}
          </button>
        );
      }
    });

    return crumbs;
  };

  return (
    <div className="ytm-app-layout">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="ytm-toast" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Professional YouTube Music Navbar */}
      <Navbar
        currentPage="playlists"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        searchValue={searchFilter}
        onSearchChange={handleSearchFilterChange}
        searchPlaceholder="Filter songs & folders..."
      />

      {/* Main Container */}
      <main className="ytm-main-content">
        {!user ? (
          <div className="ytm-empty-block" style={{ maxWidth: '580px', margin: '60px auto' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '12px', color: '#fff' }}>
              Sign in for Personal Library
            </h2>
            <p style={{ color: '#aaa', fontSize: '15px', lineHeight: '1.6', marginBottom: '24px' }}>
              Playlists in Sodo Music are account-specific. Sign in to create hierarchical folders, organize tracks, and sync favorites.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ytm-btn-pill-red"
                onClick={() => onNavigate('login')}
              >
                Sign In / Register
              </button>
              <button
                type="button"
                className="ytm-btn-pill-outline"
                onClick={() => onNavigate('yt-search')}
              >
                Search Music on YouTube
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Breadcrumb Navigation Bar */}
            <div className="ytm-playlist-toolbar">
              <div className="ytm-breadcrumb-trail">{renderBreadcrumbs()}</div>

              <div className="ytm-toolbar-actions">
                {/* View Mode Toggle: [📂 Folder Cards] vs [🌲 Visual Tree Map] */}
                <div className="ytm-pill-toggle-group">
                  <button
                    type="button"
                    className={`ytm-pill-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                    onClick={() => setViewMode('cards')}
                    title="Folder Cards View"
                  >
                    <span>📂 Cards</span>
                  </button>
                  <button
                    type="button"
                    className={`ytm-pill-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
                    onClick={() => setViewMode('tree')}
                    title="Visual Tree Map"
                  >
                    <span>🌲 Tree Map</span>
                  </button>
                </div>

                {/* Play Folder Action */}
                <button
                  type="button"
                  className="ytm-btn-pill-red"
                  onClick={handlePlayCurrentFolder}
                  disabled={folderData.videos.length === 0}
                  title={`Stream all ${folderData.videos.length} tracks in this folder branch`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Play Folder</span>
                </button>

                {/* Create Subfolder Button */}
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => setIsCreatingSubfolder(true)}
                  title="Add a nested subfolder"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>+ Subfolder</span>
                </button>

                {/* Delete current folder (if custom) */}
                {currentPath !== 'ALL' && currentPath !== 'FAVORITES' && (
                  <button
                    type="button"
                    className="ytm-btn-pill-ghost danger"
                    onClick={handleDeleteFolder}
                    title="Delete this folder and subfolders"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="ytm-alert-box" style={{ marginBottom: '20px' }}>
                <span>{error}</span>
                <button
                  type="button"
                  className="ytm-btn-pill-small"
                  onClick={() => loadFolder(currentPath, searchFilter)}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Modal: Create Subfolder */}
            {isCreatingSubfolder && (
              <div className="ytm-modal-backdrop" onClick={() => setIsCreatingSubfolder(false)}>
                <div className="ytm-modal-box" onClick={(e) => e.stopPropagation()}>
                  <div className="ytm-modal-header">
                    <h4 className="ytm-modal-title">
                      Create Subfolder under <span style={{ color: '#ff0000' }}>{currentPath}</span>
                    </h4>
                    <button type="button" className="ytm-modal-close" onClick={() => setIsCreatingSubfolder(false)}>
                      ✕
                    </button>
                  </div>
                  <form onSubmit={handleCreateSubfolder} style={{ padding: '20px' }}>
                    <label style={{ fontSize: '13px', color: '#aaa', display: 'block', marginBottom: '8px' }}>
                      Subfolder Name or Deeper Path:
                    </label>
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. OLD or 2010/WINTER"
                      value={newSubfolderInput}
                      onChange={(e) => setNewSubfolderInput(e.target.value)}
                      className="ytm-input"
                      style={{ width: '100%', marginBottom: '20px' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                        type="button"
                        className="ytm-btn-pill-ghost"
                        onClick={() => setIsCreatingSubfolder(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="ytm-btn-pill-red">
                        Create Subfolder
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Folder Header Banner */}
            <div className="ytm-folder-header-card">
              <div className="ytm-folder-header-avatar">
                {currentPath === 'FAVORITES' ? '⭐' : currentPath === 'ALL' ? '🎵' : '📁'}
              </div>
              <div className="ytm-folder-header-info">
                <span className="ytm-section-eyebrow">FOLDER PLAYLIST</span>
                <h1 className="ytm-folder-header-title">{currentPath}</h1>
                <p className="ytm-folder-header-sub">
                  {folderData.total_videos} {folderData.total_videos === 1 ? 'track' : 'tracks'}
                  {currentPath === 'ALL'
                    ? ' • Entire aggregated library'
                    : currentPath === 'FAVORITES'
                    ? ' • Starred across all folders'
                    : ' • Recursive aggregated stream'}
                </p>
                <div className="ytm-folder-header-actions">
                  <button
                    type="button"
                    className="ytm-btn-pill-red"
                    onClick={handlePlayCurrentFolder}
                    disabled={folderData.videos.length === 0}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Play</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Conditional View: [Folder Cards] vs [Visual Tree Map] */}
            {viewMode === 'tree' ? (
              <div style={{ marginBottom: '32px' }}>
                <FolderTreeVisualizer
                  folders={allTreeFolders}
                  totalSongs={totalLibrarySongs}
                  favoriteSongs={favoriteLibrarySongs}
                  selectedPath={currentPath}
                  onSelectFolder={(p) => setCurrentPath(p)}
                  onPlayFolder={(p) => handlePlaySpecificFolder(p)}
                />
              </div>
            ) : (
              /* SECTION 1: CHILD FOLDERS */
              folderData.subfolders.length > 0 && (
                <section className="ytm-home-section">
                  <div className="ytm-section-header-row">
                    <div>
                      <span className="ytm-section-eyebrow">SUB-BRANCHES</span>
                      <h2 className="ytm-section-main-title">
                        Child Folders
                        <span className="ytm-title-count">({folderData.subfolders.length})</span>
                      </h2>
                    </div>
                  </div>

                  <div className="ytm-folders-grid">
                    {folderData.subfolders.map((sf) => {
                      const isFav = sf.path === 'FAVORITES';
                      return (
                        <div
                          key={sf.path}
                          className={`ytm-folder-card ${isFav ? 'is-favorites' : ''}`}
                          onClick={() => handleBreadcrumbClick(sf.path)}
                        >
                          <div className="ytm-folder-avatar-box">
                            {isFav ? '⭐' : '📁'}
                          </div>
                          <div className="ytm-folder-text-box">
                            <div className="ytm-folder-heading">{sf.name}</div>
                            <div className="ytm-folder-caption">
                              {sf.song_count} {sf.song_count === 1 ? 'track' : 'tracks'}
                            </div>
                          </div>
                          <div className="ytm-folder-arrow">→</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )
            )}

            {/* SECTION 2: ALL CHILD SONGS */}
            <section className="ytm-home-section" style={{ marginTop: '24px' }}>
              <div className="ytm-section-header-row">
                <div>
                  <span className="ytm-section-eyebrow">TRACKS</span>
                  <h2 className="ytm-section-main-title">
                    Songs in {currentPath}
                    <span className="ytm-title-count">({folderData.videos.length})</span>
                  </h2>
                </div>
                {folderData.videos.length > 0 && (
                  <div className="ytm-section-actions">
                    <button
                      type="button"
                      className="ytm-btn-pill-outline"
                      onClick={handlePlayCurrentFolder}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>Play All</span>
                    </button>
                  </div>
                )}
              </div>

              {isLoading ? (
                <div className="ytm-loading-skeletons">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="ytm-skeleton-row" />
                  ))}
                </div>
              ) : folderData.videos.length === 0 ? (
                <div className="ytm-empty-block">
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>📁</div>
                  <p style={{ color: '#fff', fontSize: '16px', fontWeight: '500', marginBottom: '6px' }}>
                    {searchFilter ? `No songs matched "${searchFilter}"` : `No songs in "${currentPath}"`}
                  </p>
                  <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '16px' }}>
                    Search YouTube to add music into this playlist folder.
                  </p>
                  <button
                    type="button"
                    className="ytm-btn-pill-red"
                    onClick={() => onNavigate('yt-search')}
                  >
                    Find on YouTube
                  </button>
                </div>
              ) : (
                <div className="ytm-tracklist-container">
                  {folderData.videos.map((video, idx) => {
                    const vid = video.video_id || video.id;
                    const isCurrent =
                      currentTrack &&
                      (currentTrack.video_id === vid || currentTrack.id === video.id);

                    return (
                      <div
                        key={video.id}
                        className={`ytm-track-row ${isCurrent ? 'is-active' : ''}`}
                        onClick={() => playTrack(video, folderData.videos)}
                      >
                        {/* Index */}
                        <div className="ytm-track-idx-col">
                          {isCurrent && isPlaying ? (
                            <div className="ytm-equalizer-bars mini">
                              <span />
                              <span />
                              <span />
                            </div>
                          ) : (
                            <>
                              <span className="ytm-idx-num">{idx + 1}</span>
                              <span className="ytm-idx-play">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <polygon points="6 4 19 12 6 20 6 4" />
                                </svg>
                              </span>
                            </>
                          )}
                        </div>

                        {/* Thumbnail */}
                        <div className="ytm-track-art-box">
                          <img src={video.thumbnail} alt={video.title} className="ytm-track-art" loading="lazy" />
                        </div>

                        {/* Title & Artist */}
                        <div className="ytm-track-info-col">
                          <div className={`ytm-track-title ${isCurrent ? 'highlight' : ''}`}>{video.title}</div>
                          <div className="ytm-track-artist">{video.channel}</div>
                        </div>

                        {/* Folder Path Tag */}
                        <div className="ytm-track-folder-col">
                          <span
                            className="ytm-folder-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBreadcrumbClick(video.folder_path);
                            }}
                            title={`Folder: ${video.folder_path}`}
                          >
                            📂 {video.folder_path}
                          </span>
                        </div>

                        {/* Duration */}
                        <div className="ytm-track-time">{video.duration || '3:30'}</div>

                        {/* Action Buttons: Play Video, Favorite, Move, Copy, Delete */}
                        <div className="ytm-track-inline-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="ytm-icon-btn"
                            onClick={() => {
                              playVideo(video, folderData.videos);
                              showToast(`🎬 Playing in Video Mode`);
                            }}
                            title="Play Video"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className={`ytm-icon-btn ${video.is_favorite ? 'is-active' : ''}`}
                            onClick={() => handleToggleFavorite(video.id)}
                            title={video.is_favorite ? 'Favorited' : 'Mark Favorite'}
                          >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill={video.is_favorite ? '#ff0000' : 'none'} stroke={video.is_favorite ? '#ff0000' : 'currentColor'} strokeWidth="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className="ytm-icon-btn"
                            onClick={() => copyToClipboard(`https://www.youtube.com/watch?v=${vid}`)}
                            title="Copy link"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className="ytm-icon-btn"
                            onClick={() => setAddToPlaylistVideo(video)}
                            title="Move / Copy to folder"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className="ytm-icon-btn danger"
                            onClick={() => handleRemoveItem(video.id)}
                            title="Remove from playlist"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Add / Move to Playlist Modal */}
      {addToPlaylistVideo && (
        <AddToPlaylistModal
          video={{
            id: addToPlaylistVideo.video_id || addToPlaylistVideo.id,
            title: addToPlaylistVideo.title,
            thumbnail: addToPlaylistVideo.thumbnail,
            channel: addToPlaylistVideo.channel,
            duration: addToPlaylistVideo.duration,
            views: addToPlaylistVideo.views,
          }}
          onClose={() => setAddToPlaylistVideo(null)}
          onSuccess={(path) => {
            showToast(`Added to ${path}`);
            loadFolder(currentPath, searchFilter);
            loadFullTree();
          }}
        />
      )}
    </div>
  );
}
