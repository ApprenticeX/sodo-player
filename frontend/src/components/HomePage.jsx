import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { usePlayer } from '../context/PlayerContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { FolderTreeVisualizer } from './FolderTreeVisualizer';
import { Navbar } from './Navbar';

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const FILTER_CHIPS = ['All', 'Favorites', 'Listen Again', 'Quick Picks', 'Playlists'];

export function HomePage({ user, onNavigate, onLogout }) {
  const [allSongs, setAllSongs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [totalSongsCount, setTotalSongsCount] = useState(0);
  const [favSongsCount, setFavSongsCount] = useState(0);
  const [quickPicks, setQuickPicks] = useState([]);
  const [listenAgain, setListenAgain] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [activeChip, setActiveChip] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Toggle for embedded Tree Visualizer
  const [showTreeVis, setShowTreeVis] = useState(false);

  // Modals & Menu
  const [addToPlaylistVideo, setAddToPlaylistVideo] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const menuRef = useRef(null);

  const { playTrack, playVideo, playPlaylist, currentTrack, isPlaying, toggleFavoriteTrack } = usePlayer();

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const copyToClipboard = async (url) => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(url);
      showToast('Video link copied to clipboard!');
    } catch {
      showToast('Copied: ' + url);
    }
  };

  // Close 3-dot menus on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadLibrary = useCallback(async () => {
    if (!user && !api.getToken()) {
      setIsLoading(false);
      setAllSongs([]);
      setFolders([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch all songs recursively from ALL
      const folderRes = await api.getFolderContents('ALL');
      const songs = folderRes.videos || [];
      setAllSongs(songs);

      // 2. Generate curated batches strictly from saved library
      if (songs.length > 0) {
        const shuffled = shuffleArray(songs);
        setQuickPicks(shuffled.slice(0, 8));
        setListenAgain(shuffled.slice(8, 16).length > 0 ? shuffled.slice(8, 16) : shuffled.slice(0, 6));
      } else {
        setQuickPicks([]);
        setListenAgain([]);
      }

      // 3. Fetch folder tree
      const treeRes = await api.getFolderTree();
      setFolders(treeRes.folders || []);
      setTotalSongsCount(treeRes.total_songs || songs.length);
      setFavSongsCount(treeRes.favorite_songs || 0);
    } catch (err) {
      console.error('Failed to load library:', err);
      if (err.status === 401) {
        setError(null);
      } else {
        setError('Unable to load saved music library.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Load library on mount or user change
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const refreshQuickPicks = () => {
    if (allSongs.length > 0) {
      setQuickPicks(shuffleArray(allSongs).slice(0, 8));
      showToast('Refreshed picks strictly from your saved library!');
    }
  };

  // Filter songs based on search and active chip
  const filteredSongs = allSongs.filter((song) => {
    if (activeChip === 'Favorites' && !song.is_favorite) return false;

    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      (song.title && song.title.toLowerCase().includes(q)) ||
      (song.channel && song.channel.toLowerCase().includes(q)) ||
      (song.folder_path && song.folder_path.toLowerCase().includes(q))
    );
  });

  // Top root folders for playlists section
  const rootFolders = folders.filter((f) => !f.parent_path);

  // Play a specific folder by path
  const playFolderByPath = async (folderPath) => {
    try {
      const data = await api.getFolderContents(folderPath);
      if (data.videos && data.videos.length > 0) {
        playPlaylist(folderPath, data.videos, 0);
        showToast(`▶ Streaming ${data.videos.length} tracks in "${folderPath}"`);
      } else {
        showToast(`No tracks in "${folderPath}".`);
      }
    } catch (err) {
      console.error('Error playing folder branch:', err);
    }
  };

  const handleToggleFavoriteSong = async (songId) => {
    const isFav = await toggleFavoriteTrack(songId);
    setAllSongs((prev) =>
      prev.map((s) => (s.id === songId ? { ...s, is_favorite: isFav ? 1 : 0 } : s))
    );
    showToast(isFav ? '⭐ Added to Favorites' : 'Removed from Favorites');
  };

  // Check if a song is currently playing
  const isSongPlaying = (song) => {
    if (!currentTrack) return false;
    const vid = song.video_id || song.id;
    return (currentTrack.video_id === vid || currentTrack.id === song.id) && isPlaying;
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
        currentPage="home"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        searchValue={filterQuery}
        onSearchChange={setFilterQuery}
        searchPlaceholder="Search saved songs, artists, folders..."
      />

      {/* Quick Filter Chips Row (Authentic YouTube Music) */}
      <div className="ytm-chips-container">
        <div className="ytm-chips-scroll">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className={`ytm-filter-chip ${activeChip === chip ? 'active' : ''}`}
              onClick={() => setActiveChip(chip)}
            >
              {chip === 'Favorites' ? '⭐ Favorites' : chip}
            </button>
          ))}
        </div>
      </div>

      {/* Main YouTube Music Home Feed */}
      <main className="ytm-main-content">
        {/* Guest Welcome Banner */}
        {!user && !api.getToken() && (
          <div
            className="ytm-account-hero-card"
            style={{
              marginBottom: '28px',
              background: 'linear-gradient(135deg, #181818 0%, #101010 100%)',
              border: '1px solid var(--border-medium)',
            }}
          >
            <div style={{ fontSize: '40px', flexShrink: 0 }}>🎵</div>
            <div className="ytm-account-info-col">
              <h2 className="ytm-account-name">Welcome to Sodo Music Player</h2>
              <p className="ytm-account-email" style={{ marginTop: '4px', maxWidth: '600px' }}>
                Search and stream millions of songs from YouTube, download audio locally for high-speed offline listening,
                or sign in to create account-scoped playlists and nested folders.
              </p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ytm-btn-pill-red"
                  onClick={() => onNavigate('yt-search')}
                >
                  ▶ Search YouTube Music
                </button>
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => onNavigate('login')}
                >
                  Sign In / Register
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="ytm-alert-box">
            <span>{error}</span>
            <button type="button" className="ytm-btn-pill-small" onClick={loadLibrary}>
              Retry
            </button>
          </div>
        )}

        {/* Collapsible Folder Tree Visualizer */}
        {showTreeVis && (
          <div className="ytm-tree-panel">
            <div className="ytm-tree-panel-header">
              <div>
                <h3 className="ytm-tree-title">Library Tree Hierarchy & Navigation</h3>
                <p className="ytm-tree-desc">
                  Explore full nesting or click any branch to view in Library or stream directly
                </p>
              </div>
              <button
                type="button"
                className="ytm-btn-pill-outline"
                onClick={() => setShowTreeVis(false)}
              >
                ✕ Close
              </button>
            </div>
            <FolderTreeVisualizer
              folders={folders}
              totalSongs={totalSongsCount}
              favoriteSongs={favSongsCount}
              selectedPath="ALL"
              onSelectFolder={() => onNavigate('playlists')}
              onPlayFolder={(path) => playFolderByPath(path)}
            />
          </div>
        )}

        {/* SECTION 1: QUICK PICKS (Square Card Grid) */}
        {(activeChip === 'All' || activeChip === 'Quick Picks') && (
          <section className="ytm-home-section">
            <div className="ytm-section-header-row">
              <div>
                <span className="ytm-section-eyebrow">START RADIO FROM A SONG</span>
                <h2 className="ytm-section-main-title">Quick Picks</h2>
              </div>
              <div className="ytm-section-actions">
                {quickPicks.length > 0 && (
                  <button
                    type="button"
                    className="ytm-btn-pill-outline"
                    onClick={() => playPlaylist('Quick Picks', quickPicks, 0)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Play all</span>
                  </button>
                )}
                <button
                  type="button"
                  className="ytm-btn-pill-ghost"
                  onClick={refreshQuickPicks}
                  title="Refresh recommendations"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {quickPicks.length === 0 ? (
              <div className="ytm-empty-block">
                <p>No saved songs yet to suggest. Search YouTube and add songs to your library!</p>
                <button
                  type="button"
                  className="ytm-btn-pill-red"
                  onClick={() => onNavigate('yt-search')}
                >
                  Explore YouTube
                </button>
              </div>
            ) : (
              <div className="ytm-cards-grid">
                {quickPicks.map((song) => {
                  const playing = isSongPlaying(song);

                  return (
                    <div
                      key={`pick-${song.id}`}
                      className={`ytm-music-card ${playing ? 'is-playing' : ''}`}
                      onClick={() => playTrack(song, quickPicks)}
                    >
                      <div className="ytm-card-artwork-box">
                        <img
                          src={song.thumbnail}
                          alt={song.title}
                          className="ytm-card-artwork"
                          loading="lazy"
                        />
                        <div className="ytm-card-play-hover">
                          {playing ? (
                            <div className="ytm-equalizer-bars">
                              <span />
                              <span />
                              <span />
                            </div>
                          ) : (
                            <div className="ytm-round-play-btn" title="Play">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="6 4 19 12 6 20 6 4" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="ytm-card-meta">
                        <div className="ytm-card-title" title={song.title}>
                          {song.title}
                        </div>
                        <div className="ytm-card-subtitle" title={song.channel}>
                          {song.channel}
                        </div>
                        {song.folder_path && (
                          <span className="ytm-card-tag">📂 {song.folder_path}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* SECTION 2: LISTEN AGAIN (Square Card Grid) */}
        {(activeChip === 'All' || activeChip === 'Listen Again') && listenAgain.length > 0 && (
          <section className="ytm-home-section">
            <div className="ytm-section-header-row">
              <div>
                <span className="ytm-section-eyebrow">SAVED IN YOUR ROTATION</span>
                <h2 className="ytm-section-main-title">Listen Again</h2>
              </div>
              <div className="ytm-section-actions">
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => playPlaylist('Listen Again', listenAgain, 0)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Play all</span>
                </button>
              </div>
            </div>

            <div className="ytm-cards-grid">
              {listenAgain.map((song) => {
                const playing = isSongPlaying(song);

                return (
                  <div
                    key={`listen-${song.id}`}
                    className={`ytm-music-card ${playing ? 'is-playing' : ''}`}
                    onClick={() => playTrack(song, listenAgain)}
                  >
                    <div className="ytm-card-artwork-box">
                      <img
                        src={song.thumbnail}
                        alt={song.title}
                        className="ytm-card-artwork"
                        loading="lazy"
                      />
                      <div className="ytm-card-play-hover">
                        {playing ? (
                          <div className="ytm-equalizer-bars">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : (
                          <div className="ytm-round-play-btn" title="Play">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6 4 19 12 6 20 6 4" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="ytm-card-meta">
                      <div className="ytm-card-title" title={song.title}>
                        {song.title}
                      </div>
                      <div className="ytm-card-subtitle" title={song.channel}>
                        {song.channel}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 3: YOUR PLAYLISTS & FOLDERS */}
        {(activeChip === 'All' || activeChip === 'Playlists') && (
          <section className="ytm-home-section">
            <div className="ytm-section-header-row">
              <div>
                <span className="ytm-section-eyebrow">YOUR COLLECTION</span>
                <h2 className="ytm-section-main-title">Playlists & Hierarchical Folders</h2>
              </div>
              <div className="ytm-section-actions">
                <button
                  type="button"
                  className="ytm-btn-pill-ghost"
                  onClick={() => setShowTreeVis(!showTreeVis)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span>{showTreeVis ? 'Hide Tree Map' : 'Tree Map'}</span>
                </button>
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => onNavigate('playlists')}
                >
                  <span>View all</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="ytm-folders-grid">
              {/* Pinned Favorites Folder Card */}
              <div
                className="ytm-folder-card is-favorites"
                onClick={() => onNavigate('playlists')}
              >
                <div className="ytm-folder-avatar-box">
                  <span className="ytm-folder-star-icon">★</span>
                </div>
                <div className="ytm-folder-text-box">
                  <div className="ytm-folder-heading">Favorites</div>
                  <div className="ytm-folder-caption">
                    Starred songs across all playlists
                  </div>
                </div>
                <button
                  type="button"
                  className="ytm-folder-play-action"
                  title="Play Favorites"
                  onClick={(e) => {
                    e.stopPropagation();
                    const favs = allSongs.filter((s) => s.is_favorite);
                    playPlaylist('Favorites', favs.length > 0 ? favs : allSongs, 0);
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 4 19 12 6 20 6 4" />
                  </svg>
                </button>
              </div>

              {/* Root Hierarchical Folders */}
              {rootFolders.map((folder) => {
                const folderSongs = allSongs.filter(
                  (s) => s.folder_path === folder.path || s.folder_path.startsWith(folder.path + '/')
                );

                return (
                  <div
                    key={folder.path}
                    className="ytm-folder-card"
                    onClick={() => onNavigate('playlists')}
                  >
                    <div className="ytm-folder-avatar-box">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                    <div className="ytm-folder-text-box">
                      <div className="ytm-folder-heading">{folder.name}</div>
                      <div className="ytm-folder-caption">
                        {folderSongs.length} {folderSongs.length === 1 ? 'track' : 'tracks'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ytm-folder-play-action"
                      title={`Play all in ${folder.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (folderSongs.length > 0) {
                          playPlaylist(folder.name, folderSongs, 0);
                        } else {
                          showToast(`No songs in ${folder.name} yet.`);
                        }
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6 4 19 12 6 20 6 4" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 4: ALL SONGS (Interactive Tracklist) */}
        <section className="ytm-home-section">
          <div className="ytm-section-header-row">
            <div>
              <span className="ytm-section-eyebrow">
                {activeChip === 'Favorites' ? 'STARRED TRACKS' : 'SAVED LIBRARY'}
              </span>
              <h2 className="ytm-section-main-title">
                {activeChip === 'Favorites' ? 'Favorites' : 'All Songs'}
                <span className="ytm-title-count">({filteredSongs.length})</span>
              </h2>
            </div>
            {filteredSongs.length > 0 && (
              <div className="ytm-section-actions">
                <button
                  type="button"
                  className="ytm-btn-pill-red"
                  onClick={() => playPlaylist('Library', filteredSongs, 0)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Play All</span>
                </button>
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => playPlaylist('Library Shuffled', shuffleArray(filteredSongs), 0)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                    <line x1="4" y1="4" x2="9" y2="9" />
                  </svg>
                  <span>Shuffle</span>
                </button>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="ytm-loading-skeletons">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="ytm-skeleton-row" />
              ))}
            </div>
          ) : filteredSongs.length === 0 ? (
            <div className="ytm-empty-block">
              <p>{filterQuery ? `No songs matched "${filterQuery}".` : 'Your library is empty.'}</p>
              <button
                type="button"
                className="ytm-btn-pill-red"
                onClick={() => onNavigate('yt-search')}
              >
                Find Songs on YouTube
              </button>
            </div>
          ) : (
            <div className="ytm-tracklist-container" ref={menuRef}>
              {filteredSongs.map((song, idx) => {
                const vid = song.video_id || song.id;
                const playing = isSongPlaying(song);
                const isCurrent =
                  currentTrack &&
                  (currentTrack.video_id === vid || currentTrack.id === song.id);
                const isMenuOpen = openMenuId === song.id;

                return (
                  <div
                    key={`track-${song.id}`}
                    className={`ytm-track-row ${isCurrent ? 'is-active' : ''}`}
                    onClick={() => playTrack(song, filteredSongs)}
                  >
                    {/* Index / Play Indicator */}
                    <div className="ytm-track-idx-col">
                      {playing ? (
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

                    {/* Thumbnail Artwork */}
                    <div className="ytm-track-art-box">
                      <img src={song.thumbnail} alt={song.title} className="ytm-track-art" loading="lazy" />
                    </div>

                    {/* Title & Artist */}
                    <div className="ytm-track-info-col">
                      <div className={`ytm-track-title ${isCurrent ? 'highlight' : ''}`} title={song.title}>
                        {song.title}
                      </div>
                      <div className="ytm-track-artist" title={song.channel}>
                        {song.channel}
                      </div>
                    </div>

                    {/* Folder Path Pill */}
                    <div className="ytm-track-folder-col">
                      {song.folder_path && (
                        <span
                          className="ytm-folder-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigate('playlists');
                          }}
                          title={`Folder: ${song.folder_path}. Click to view in Library.`}
                        >
                          📂 {song.folder_path}
                        </span>
                      )}
                    </div>

                    {/* Favorite Heart / Star Button */}
                    <button
                      type="button"
                      className={`ytm-fav-icon-btn ${song.is_favorite ? 'is-fav' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavoriteSong(song.id);
                      }}
                      title={song.is_favorite ? 'Favorited' : 'Add to Favorites'}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={song.is_favorite ? '#ff0000' : 'none'} stroke={song.is_favorite ? '#ff0000' : 'currentColor'} strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    </button>

                    {/* Duration */}
                    <div className="ytm-track-time">{song.duration || '3:30'}</div>

                    {/* 3-Dot Options Menu */}
                    <div className="ytm-track-menu-zone" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="ytm-dots-action-btn"
                        onClick={() => setOpenMenuId(isMenuOpen ? null : song.id)}
                        title="More options"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>

                      {isMenuOpen && (
                        <div className="ytm-context-menu">
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              playTrack(song);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6 4 19 12 6 20 6 4" />
                            </svg>
                            <span>Play now (Music Mode)</span>
                          </button>
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              playVideo(song);
                              setOpenMenuId(null);
                              showToast(`🎬 Playing in Video Mode`);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                            </svg>
                            <span>Play Video</span>
                          </button>
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              handleToggleFavoriteSong(song.id);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={song.is_favorite ? '#ff0000' : 'none'} stroke="currentColor" strokeWidth="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                            <span>{song.is_favorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                          </button>
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              setAddToPlaylistVideo(song);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                            <span>Move / Add to Folder</span>
                          </button>
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              copyToClipboard(`https://www.youtube.com/watch?v=${vid}`);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            <span>Copy link</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
          onNavigate={onNavigate}
          onClose={() => setAddToPlaylistVideo(null)}
          onSuccess={(path) => {
            showToast(`Saved to ${path}`);
            loadLibrary();
          }}
        />
      )}
    </div>
  );
}
