import React, { useState } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function MusicPlayerBar({ onNavigate, user }) {
  const {
    currentTrack,
    setCurrentTrack,
    isPlaying,
    queue,
    queueIndex,
    playlistTitle,
    currentTime,
    duration,
    volume,
    isMuted,
    isShuffle,
    repeatMode,
    isQueueOpen,
    isVideoExpanded,
    playerMode,
    setPlayerMode,
    togglePlayerMode,
    playbackEngine,
    isBuffering,
    bufferedPercent,
    downloadStatus,
    downloadCurrentTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    setIsQueueOpen,
    toggleFavoriteTrack,
    playTrack,
  } = usePlayer();

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);

  const displayTime = isScrubbing ? scrubValue : currentTime;
  const progressPercent = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;
  const bufferPercentClamped = Math.min(100, Math.max(0, bufferedPercent));

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleScrubberChange = (e) => {
    const val = parseFloat(e.target.value);
    setScrubValue(val);
  };

  const handleScrubberMouseDown = () => {
    setIsScrubbing(true);
  };

  const handleScrubberMouseUp = (e) => {
    const val = parseFloat(e.target.value);
    seekTo(val);
    setIsScrubbing(false);
  };

  const handleCopyLink = async () => {
    if (!currentTrack) return;
    const vid = currentTrack.video_id || currentTrack.id;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      showToast('Video link copied to clipboard!');
    } catch {
      showToast('Copied: ' + url);
    }
  };

  const handleDownload = async () => {
    if (!downloadCurrentTrack) return;
    showToast('Starting offline audio download...');
    const res = await downloadCurrentTrack();
    if (res && res.status === 'completed') {
      showToast('✓ Audio downloaded for local playback');
    } else if (res && res.status === 'downloading') {
      showToast('Downloading in background...');
    }
  };

  if (!currentTrack) {
    return null;
  }

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="ytm-player-toast">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Slide-Up Queue Drawer */}
      {isQueueOpen && (
        <div className="ytm-queue-drawer">
          <div className="ytm-queue-header">
            <div>
              <h4 className="ytm-queue-title">Playing Queue</h4>
              <span className="ytm-queue-meta">
                {playlistTitle} • {queue.length} {queue.length === 1 ? 'song' : 'songs'}
              </span>
            </div>
            <button
              type="button"
              className="ytm-queue-close"
              onClick={() => setIsQueueOpen(false)}
              aria-label="Close Queue"
            >
              ✕
            </button>
          </div>

          <div className="ytm-queue-tracklist">
            {queue.map((track, i) => {
              const isCurrent = i === queueIndex;
              return (
                <div
                  key={`${track.id || track.video_id}-${i}`}
                  className={`ytm-queue-row ${isCurrent ? 'is-active' : ''}`}
                  onClick={() => playTrack(track, queue)}
                >
                  <div className="ytm-queue-idx">
                    {isCurrent && isPlaying ? (
                      <div className="ytm-equalizer-bars mini">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="ytm-queue-thumb"
                  />
                  <div className="ytm-queue-info">
                    <div className="ytm-queue-song-title">{track.title}</div>
                    <div className="ytm-queue-song-artist">
                      {track.channel} {track.folder_path && `• 📂 ${track.folder_path}`}
                    </div>
                  </div>
                  {track.duration && (
                    <div className="ytm-queue-duration">{track.duration}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Persistent Bottom Music Player Bar */}
      <footer className="ytm-player-bar-root">
        {/* Top Flush Hairline Seekbar / Progress Bar */}
        <div className="ytm-player-rail-container">
          {/* Buffer Track Bar */}
          <div
            className="ytm-player-buffer-track"
            style={{ width: `${bufferPercentClamped}%` }}
          />

          {/* Active Red Progress Bar */}
          <div
            className="ytm-player-played-track"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Interactive Range Input */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.2}
            value={displayTime}
            onChange={handleScrubberChange}
            onMouseDown={handleScrubberMouseDown}
            onMouseUp={handleScrubberMouseUp}
            className="ytm-player-scrubber-slider"
            aria-label="Seek time"
          />
        </div>

        <div className="ytm-player-bar-content">
          {/* LEFT: Track Info & Favorite Heart */}
          <div className="ytm-bar-left-zone">
            <div
              className="ytm-bar-artwork-wrap"
              onClick={togglePlayerMode}
              title={playerMode === 'music' ? 'Playing in Music Mode. Click to watch video.' : 'Playing in Video Mode. Click to switch to Music.'}
            >
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="ytm-bar-artwork"
              />
              <div className="ytm-bar-art-hover">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points={isVideoExpanded ? '6 9 12 15 18 9' : '18 15 12 9 6 15'} />
                </svg>
              </div>
            </div>

            <div className="ytm-bar-metadata">
              <div
                className="ytm-bar-song-title"
                title={currentTrack.title}
                onClick={togglePlayerMode}
              >
                {currentTrack.title}
              </div>
              <div className="ytm-bar-artist-row">
                <span className="ytm-bar-artist-name">{currentTrack.channel}</span>

                {currentTrack.folder_path ? (
                  <button
                    type="button"
                    className="ytm-bar-folder-pill"
                    onClick={() => onNavigate && onNavigate('playlists')}
                    title={`Folder: ${currentTrack.folder_path}. Click to view in Library.`}
                  >
                    📂 {currentTrack.folder_path}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ytm-bar-folder-pill add-new"
                    onClick={() => setIsAddToPlaylistOpen(true)}
                    title="Track is not in any playlist. Click to add to a playlist."
                  >
                    ➕ Add to Playlist
                  </button>
                )}

                <span
                  className={`ytm-bar-engine-tag ${playbackEngine === 'local' ? 'is-local' : 'is-yt'}`}
                  title={playbackEngine === 'local' ? 'Local HTTP 206 range stream' : 'YouTube stream'}
                >
                  {playbackEngine === 'local' ? '⚡ Local' : '▶ YT'}
                </span>

                <button
                  type="button"
                  className={`ytm-bar-mode-badge ${playerMode === 'music' ? 'music' : 'video'}`}
                  onClick={togglePlayerMode}
                  title={playerMode === 'music' ? 'Currently in Music Mode. Click to switch to Video.' : 'Currently in Video Mode. Click to switch to Music.'}
                >
                  {playerMode === 'music' ? '🎵 Song' : '🎬 Video'}
                </button>
              </div>
            </div>

            {/* Favorite Heart Toggle Button */}
            <button
              type="button"
              className={`ytm-bar-fav-btn ${currentTrack.is_favorite ? 'is-favorited' : ''}`}
              onClick={() => toggleFavoriteTrack(currentTrack.id)}
              title={currentTrack.is_favorite ? 'Favorited' : 'Add to Favorites'}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill={currentTrack.is_favorite ? '#ff0000' : 'none'}
                stroke={currentTrack.is_favorite ? '#ff0000' : 'currentColor'}
                strokeWidth="2"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>

            {/* Add to Playlist Quick Button */}
            <button
              type="button"
              className="ytm-bar-playlist-btn"
              onClick={() => setIsAddToPlaylistOpen(true)}
              title={currentTrack.folder_path ? `Move or add to playlist (Current: ${currentTrack.folder_path})` : "Add to Playlist"}
              aria-label="Add to Playlist"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* CENTER: Playback Controls */}
          <div className="ytm-bar-center-zone">
            <div className="ytm-controls-cluster">
              {/* Shuffle */}
              <button
                type="button"
                className={`ytm-icon-btn ${isShuffle ? 'is-active' : ''}`}
                onClick={toggleShuffle}
                title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 3 21 3 21 8" />
                  <line x1="4" y1="20" x2="21" y2="3" />
                  <polyline points="21 16 21 21 16 21" />
                  <line x1="15" y1="15" x2="21" y2="21" />
                  <line x1="4" y1="4" x2="9" y2="9" />
                </svg>
              </button>

              {/* Previous */}
              <button
                type="button"
                className="ytm-icon-btn"
                onClick={prevTrack}
                title="Previous track"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>

              {/* Authentic Circular Play/Pause Button */}
              <button
                type="button"
                className={`ytm-main-play-btn ${isBuffering ? 'is-buffering' : ''}`}
                onClick={togglePlay}
                title={isBuffering ? 'Buffering...' : isPlaying ? 'Pause' : 'Play'}
              >
                {isBuffering ? (
                  <span className="ytm-play-spinner" />
                ) : isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
                    <polygon points="6 4 19 12 6 20 6 4" />
                  </svg>
                )}
              </button>

              {/* Next */}
              <button
                type="button"
                className="ytm-icon-btn"
                onClick={nextTrack}
                title="Next track"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              </button>

              {/* Repeat */}
              <button
                type="button"
                className={`ytm-icon-btn ${repeatMode !== 'off' ? 'is-active' : ''}`}
                onClick={toggleRepeat}
                title={`Repeat: ${repeatMode}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                {repeatMode === 'one' && <span className="ytm-repeat-badge">1</span>}
              </button>
            </div>

            {/* Time display */}
            <div className="ytm-bar-time-readout">
              <span>{formatTime(displayTime)}</span>
              <span className="ytm-time-slash">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* RIGHT: Volume, Actions & Queue */}
          <div className="ytm-bar-right-zone">
            {/* Download audio */}
            <button
              type="button"
              className={`ytm-icon-btn ${downloadStatus === 'completed' ? 'is-downloaded' : ''}`}
              onClick={handleDownload}
              title={
                downloadStatus === 'completed'
                  ? 'Audio downloaded locally'
                  : downloadStatus === 'downloading'
                  ? 'Downloading...'
                  : 'Download audio for local offline streaming'
              }
            >
              {downloadStatus === 'completed' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : downloadStatus === 'downloading' ? (
                <span className="ytm-download-spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
            </button>

            {/* Copy Link */}
            <button
              type="button"
              className="ytm-icon-btn"
              onClick={handleCopyLink}
              title="Copy video link"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>

            {/* Add to Playlist Action */}
            <button
              type="button"
              className="ytm-icon-btn"
              onClick={() => setIsAddToPlaylistOpen(true)}
              title="Add current track to playlist"
              aria-label="Add to Playlist"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="15" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
                <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
                <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
                <line x1="19" y1="15" x2="19" y2="21" strokeWidth="2" />
                <line x1="16" y1="18" x2="22" y2="18" strokeWidth="2" />
              </svg>
            </button>

            {/* YouTube Music Song / Video Switcher Pill */}
            <div className="ytm-mode-switch-pill" role="tablist" aria-label="Playback Mode">
              <button
                type="button"
                className={`ytm-mode-pill-btn ${playerMode === 'music' ? 'active' : ''}`}
                onClick={() => setPlayerMode('music')}
                title="Song Mode (Music & Artwork)"
                aria-selected={playerMode === 'music'}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span>Song</span>
              </button>
              <button
                type="button"
                className={`ytm-mode-pill-btn ${playerMode === 'video' ? 'active' : ''}`}
                onClick={() => setPlayerMode('video')}
                title="Video Mode (Watch Video)"
                aria-selected={playerMode === 'video'}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
                <span>Video</span>
              </button>
            </div>

            {/* Video Toggle Button */}
            <button
              type="button"
              className={`ytm-icon-btn ${playerMode === 'video' ? 'is-active' : ''}`}
              onClick={togglePlayerMode}
              title={playerMode === 'video' ? 'Switch to Music Mode (Hide Video)' : 'Play Video (Switch to Video Mode)'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>

            {/* Volume Control */}
            <div className="ytm-volume-cluster">
              <button
                type="button"
                className="ytm-icon-btn"
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="ytm-volume-slider"
                style={{
                  background: `linear-gradient(to right, #ffffff ${isMuted ? 0 : volume}%, rgba(255, 255, 255, 0.2) ${isMuted ? 0 : volume}%)`,
                }}
                aria-label="Volume"
              />
            </div>

            {/* Queue Toggle Button */}
            <button
              type="button"
              className={`ytm-queue-toggle-btn ${isQueueOpen ? 'is-active' : ''}`}
              onClick={() => setIsQueueOpen(!isQueueOpen)}
              title="Toggle Playing Queue"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span className="ytm-queue-counter">{queue.length}</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Add to Playlist Modal */}
      {isAddToPlaylistOpen && currentTrack && (
        <AddToPlaylistModal
          video={{
            id: currentTrack.video_id || currentTrack.id,
            video_id: currentTrack.video_id || currentTrack.id,
            title: currentTrack.title,
            thumbnail: currentTrack.thumbnail,
            channel: currentTrack.channel,
            duration: currentTrack.duration,
            views: currentTrack.views,
          }}
          user={user}
          onNavigate={onNavigate}
          onClose={() => setIsAddToPlaylistOpen(false)}
          onSuccess={(path) => {
            showToast(`Added to playlist "${path}"!`);
            if (setCurrentTrack) {
              setCurrentTrack((prev) => (prev ? { ...prev, folder_path: path } : prev));
            }
            window.dispatchEvent(new CustomEvent('sodo:library-changed', { detail: { path } }));
          }}
        />
      )}
    </>
  );
}
