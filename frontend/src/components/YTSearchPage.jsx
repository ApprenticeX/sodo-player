import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { Navbar } from './Navbar';
import { usePlayer } from '../context/PlayerContext';

const QUICK_TOPICS = [
  'All',
  'Lo-Fi Beats',
  'Coding Music',
  'Trending Music',
  'Podcasts',
  'Gaming Soundtrack',
  'Chillhop',
  'Synthwave',
  'Live Music',
];

export function YTSearchPage({ user, onNavigate, onLogout }) {
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('All');
  const [videos, setVideos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // 3-dot dropdown menu state
  const [openMenuId, setOpenMenuId] = useState(null);

  // Video preview modal state
  const [previewVideo, setPreviewVideo] = useState(null);
  const [addToPlaylistVideo, setAddToPlaylistVideo] = useState(null);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);
  const menuRef = useRef(null);

  const { playTrack, playVideo, currentTrack, isPlaying, playerMode } = usePlayer();

  const showToast = (message) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
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
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      showToast(`${label} copied to clipboard!`);
    } catch (err) {
      console.error('Failed to copy:', err);
      showToast(`Copied: ${text}`);
    }
  };

  // Close 3-dot dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.ytm-video-menu-wrap')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch search results
  const executeSearch = useCallback(async (queryText, updateUrl = true) => {
    const clean = (queryText || '').trim();
    if (!clean) return;

    setIsLoading(true);
    setError(null);
    setOpenMenuId(null);

    if (updateUrl) {
      const newUrl = new URL(window.location.href);
      newUrl.pathname = '/yt-search';
      newUrl.searchParams.set('q', clean);
      window.history.pushState({ q: clean }, '', newUrl.toString());
    }

    try {
      const data = await api.searchYouTube(clean, 28);
      setVideos(data.results || []);
      setActiveQuery(clean);
      if (!data.results || data.results.length === 0) {
        setError('No YouTube videos found for this search. Try different keywords.');
      }
    } catch (err) {
      console.error('YouTube search error:', err);
      setError(err.message || 'Unable to fetch YouTube results. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load trending starter videos
  const loadTrending = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTrendingYouTube(24);
      setVideos(data.results || []);
      setActiveQuery('');
    } catch (err) {
      console.error('Trending fetch error:', err);
      executeSearch('trending music and podcasts', false);
    } finally {
      setIsLoading(false);
    }
  }, [executeSearch]);

  // Sync with URL query string on mount and popstate
  useEffect(() => {
    const parseUrlAndFetch = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const q = urlParams.get('q') || urlParams.get('search');
      if (q && q.trim()) {
        setSearchInput(q);
        setActiveQuery(q);
        executeSearch(q, false);
      } else {
        loadTrending();
      }
    };

    parseUrlAndFetch();

    const handlePopState = () => parseUrlAndFetch();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [executeSearch, loadTrending]);

  const handleTopicClick = (topic) => {
    setSelectedTopic(topic);
    if (topic === 'All') {
      setSearchInput('');
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('q');
      window.history.pushState({}, '', newUrl.pathname);
      loadTrending();
    } else {
      setSearchInput(topic);
      executeSearch(topic);
    }
  };

  const handlePlaySong = (video) => {
    playTrack(
      {
        id: video.id,
        video_id: video.id,
        title: video.title,
        channel: video.channel,
        thumbnail: video.thumbnail,
        duration: video.duration,
      },
      videos,
      'music'
    );
    showToast(`▶ Playing in Music Mode`);
  };

  const handlePlayVideo = (video) => {
    playVideo(
      {
        id: video.id,
        video_id: video.id,
        title: video.title,
        channel: video.channel,
        thumbnail: video.thumbnail,
        duration: video.duration,
      },
      videos
    );
    showToast(`🎬 Playing in Video Mode`);
  };

  return (
    <div className="ytm-app-layout">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="ytm-toast" role="alert" aria-live="assertive">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top YouTube Music Navbar */}
      <Navbar
        currentPage="yt-search"
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={(val) => {
          setSelectedTopic('Custom');
          executeSearch(val);
        }}
        searchPlaceholder="Search songs, albums, artists on YouTube..."
      />

      {/* Filter Topic Pills */}
      <div className="ytm-chips-container">
        <div className="ytm-chips-scroll">
          {QUICK_TOPICS.map((topic) => (
            <button
              key={topic}
              type="button"
              className={`ytm-filter-chip ${selectedTopic === topic ? 'active' : ''}`}
              onClick={() => handleTopicClick(topic)}
            >
              {topic}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="ytm-main-content">
        {/* Results Header Status */}
        <div className="ytm-section-header-row" style={{ marginBottom: '20px' }}>
          <div>
            <span className="ytm-section-eyebrow">EXPLORE YOUTUBE</span>
            <h2 className="ytm-section-main-title">
              {activeQuery ? `Results for "${activeQuery}"` : 'Recommended & Trending Music'}
              {videos.length > 0 && <span className="ytm-title-count">({videos.length} videos)</span>}
            </h2>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="ytm-alert-box" style={{ marginBottom: '24px' }}>
            <span>{error}</span>
            <button
              type="button"
              className="ytm-btn-pill-small"
              onClick={() => executeSearch(activeQuery || 'lofi')}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="ytm-yt-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="ytm-video-card skeleton">
                <div className="ytm-video-thumb-skeleton" />
                <div className="ytm-video-info">
                  <div className="ytm-video-avatar-skeleton" />
                  <div style={{ flex: 1 }}>
                    <div className="ytm-skeleton-line short" />
                    <div className="ytm-skeleton-line" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Videos Grid */}
        {!isLoading && videos.length > 0 && (
          <div className="ytm-yt-grid">
            {videos.map((video) => {
              const isMenuOpen = openMenuId === video.id;
              const isThisPlaying =
                currentTrack &&
                (currentTrack.video_id === video.id || currentTrack.id === video.id) &&
                isPlaying;

              return (
                <div key={video.id} className={`ytm-video-card ${isMenuOpen ? 'menu-open' : ''}`}>
                  {/* Thumbnail Container: Clicking plays in Music Mode by default */}
                  <div
                    className="ytm-video-thumb-box"
                    onClick={() => handlePlaySong(video)}
                    title={`Play "${video.title}" (Music Mode)`}
                  >
                    <img
                      src={video.thumbnail}
                      alt={video.title}
                      className="ytm-video-thumb"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
                      }}
                    />
                    {video.is_live ? (
                      <span className="ytm-badge-live">● LIVE</span>
                    ) : (
                      video.duration && <span className="ytm-badge-dur">{video.duration}</span>
                    )}

                    {isThisPlaying && (
                      <span className="ytm-badge-now-playing">
                        {playerMode === 'music' ? '🎵 Playing Song' : '🎬 Playing Video'}
                      </span>
                    )}

                    <div className="ytm-video-thumb-hover">
                      {isThisPlaying ? (
                        <div className="ytm-equalizer-bars">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <div className="ytm-thumb-actions-pill" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="thumb-pill-btn music"
                            onClick={() => handlePlaySong(video)}
                            title="Play in Music Mode (Default)"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6 4 19 12 6 20 6 4" />
                            </svg>
                            <span>Song</span>
                          </button>
                          <button
                            type="button"
                            className="thumb-pill-btn video"
                            onClick={() => handlePlayVideo(video)}
                            title="Play Video"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                            </svg>
                            <span>Video</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Video Meta Info */}
                  <div className="ytm-video-info">
                    {/* Channel Avatar */}
                    <div className="ytm-channel-avatar">
                      {video.channel_thumbnail ? (
                        <img
                          src={video.channel_thumbnail}
                          alt={video.channel}
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span>{video.channel ? video.channel.charAt(0).toUpperCase() : 'Y'}</span>
                      )}
                    </div>

                    {/* Titles and Details */}
                    <div className="ytm-video-details">
                      <h3
                        className="ytm-video-title"
                        title={video.title}
                        onClick={() => handlePlaySong(video)}
                      >
                        {video.title}
                      </h3>

                      <div className="ytm-video-channel-row">
                        <span className="ytm-video-channel">{video.channel}</span>
                      </div>

                      <div className="ytm-video-stats-row">
                        {video.views && <span>{video.views}</span>}
                        {video.views && video.published && <span className="ytm-dot-sep">•</span>}
                        {video.published && <span>{video.published}</span>}
                      </div>
                    </div>

                    {/* 3-Dot Action Menu Button */}
                    <div className="ytm-video-menu-wrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`ytm-dots-action-btn ${isMenuOpen ? 'active' : ''}`}
                        aria-label="Options"
                        title="Options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId((prev) => (prev === video.id ? null : video.id));
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <div className="ytm-context-menu right-aligned" ref={menuRef}>
                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              handlePlaySong(video);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6 4 19 12 6 20 6 4" />
                            </svg>
                            <span>Play Song (Music Mode)</span>
                          </button>

                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              handlePlayVideo(video);
                              setOpenMenuId(null);
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
                              setAddToPlaylistVideo(video);
                              setOpenMenuId(null);
                            }}
                            title={!user && !api.getToken() ? 'Sign in required to save songs to playlists' : 'Add video to playlist'}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                            <span>Add to Playlist</span>
                            {!user && !api.getToken() && (
                              <span style={{ fontSize: '11px', color: '#ff9494', marginLeft: 'auto', background: 'rgba(255, 0, 0, 0.15)', padding: '2px 6px', border: '1px solid rgba(255, 0, 0, 0.3)', borderRadius: '4px' }}>
                                Sign In Required
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              setPreviewVideo(video);
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                              <line x1="8" y1="21" x2="16" y2="21" />
                              <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                            <span>Watch Preview</span>
                          </button>

                          <button
                            type="button"
                            className="ytm-menu-item"
                            onClick={() => {
                              const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.id || video.video_id}`;
                              copyToClipboard(videoUrl, 'Video link');
                              setOpenMenuId(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            <span>Copy link</span>
                          </button>

                          <a
                            href={video.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ytm-menu-item"
                            onClick={() => setOpenMenuId(null)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            <span>Open on YouTube</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty Search State */}
        {!isLoading && videos.length === 0 && !error && (
          <div className="ytm-empty-block">
            <div style={{ fontSize: '40px', marginBottom: '14px' }}>🔍</div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#fff' }}>
              Search millions of songs on YouTube
            </h3>
            <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>
              Type any keyword or topic to explore tracks and save them to your library.
            </p>
            <div className="ytm-chips-scroll" style={{ justifyContent: 'center' }}>
              {['lofi hip hop', 'synthwave 80s', 'chill acoustic', 'jazz radio', 'classical focus'].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ytm-filter-chip"
                  onClick={() => {
                    setSearchInput(s);
                    executeSearch(s);
                  }}
                >
                  "{s}"
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Video Preview Modal (Watch without leaving) */}
      {previewVideo && (
        <div className="ytm-modal-backdrop" onClick={() => setPreviewVideo(null)}>
          <div className="ytm-modal-box video-preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="ytm-modal-header">
              <h4 className="ytm-modal-title">{previewVideo.title}</h4>
              <button
                type="button"
                className="ytm-modal-close"
                onClick={() => setPreviewVideo(null)}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>

            <div className="ytm-video-frame-container">
              <iframe
                title={previewVideo.title}
                src={`https://www.youtube-nocookie.com/embed/${previewVideo.id}?autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="ytm-embed-iframe"
              />
            </div>

            <div className="ytm-modal-footer">
              <div className="ytm-preview-meta">
                <span style={{ color: '#fff', fontWeight: '500' }}>{previewVideo.channel}</span>
                {previewVideo.views && <span style={{ color: '#aaa', marginLeft: '12px' }}>{previewVideo.views}</span>}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="ytm-btn-pill-outline"
                  onClick={() => copyToClipboard(previewVideo.url, 'Video link')}
                >
                  Copy Link
                </button>
                <button
                  type="button"
                  className="ytm-btn-pill-red"
                  onClick={() => {
                    handlePlayVideo(previewVideo);
                    setPreviewVideo(null);
                  }}
                >
                  Play in Sodo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add To Playlist Modal */}
      {addToPlaylistVideo && (
        <AddToPlaylistModal
          video={addToPlaylistVideo}
          user={user}
          onNavigate={onNavigate}
          onClose={() => setAddToPlaylistVideo(null)}
          onSuccess={(path) => showToast(`Added to playlist "${path}"!`)}
        />
      )}
    </div>
  );
}
