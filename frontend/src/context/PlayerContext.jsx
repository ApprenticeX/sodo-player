/* oxlint-disable react/only-export-components */
import React, { createContext, useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';

export const PlayerContext = createContext(null);

/**
 * Extracts a canonical 11-character YouTube video ID from any track object,
 * URL string, or ID parameter.
 */
export function extractVideoId(trackOrId) {
  if (!trackOrId) return '';
  let str = '';
  if (typeof trackOrId === 'string') {
    str = trackOrId.trim();
  } else if (typeof trackOrId === 'object') {
    if (trackOrId.video_id && typeof trackOrId.video_id === 'string') {
      str = trackOrId.video_id.trim();
    } else if (trackOrId.youtube_url && typeof trackOrId.youtube_url === 'string') {
      str = trackOrId.youtube_url.trim();
    } else if (trackOrId.url && typeof trackOrId.url === 'string') {
      str = trackOrId.url.trim();
    } else if (trackOrId.id && typeof trackOrId.id === 'string') {
      str = trackOrId.id.trim();
    }
  }
  if (!str) return '';

  // Direct 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }

  // Handle ?v=... or &v=...
  const vMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (vMatch) return vMatch[1];

  // Handle youtu.be/...
  const shortMatch = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  // Handle /embed/... or /shorts/... or /v/...
  const embedMatch = str.match(/\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  // If track object was passed, test all string properties
  if (typeof trackOrId === 'object') {
    const candidates = [trackOrId.video_id, trackOrId.id, trackOrId.url, trackOrId.youtube_url];
    for (const cand of candidates) {
      if (cand && typeof cand === 'string') {
        const trimmed = cand.trim();
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
        const m = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (m) return m[1];
      }
    }
  }

  return str;
}

export function PlayerProvider({ children }) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'all' | 'one'
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [playerMode, setPlayerMode] = useState('music'); // 'music' (default) | 'video'
  const [videoTheaterMode, setVideoTheaterMode] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('All Songs');

  // Dual playback engine state: 'local' (HTML5 Audio 206 range stream) vs 'youtube' (IFrame)
  const [playbackEngine, setPlaybackEngine] = useState('youtube');
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('not_downloaded'); // 'not_downloaded' | 'downloading' | 'completed'
  const [videoError, setVideoError] = useState(null);

  const audioRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const isYtApiReadyRef = useRef(false);
  const ytTimerRef = useRef(null);
  const pendingVideoRef = useRef(null);

  const handleTrackEndedRef = useRef(null);
  const nextTrackRef = useRef(null);
  const playbackEngineRef = useRef(playbackEngine);
  const volumeRef = useRef(volume);

  useEffect(() => {
    playbackEngineRef.current = playbackEngine;
  }, [playbackEngine]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  const stopYtProgressTimer = useCallback(() => {
    if (ytTimerRef.current) {
      clearInterval(ytTimerRef.current);
      ytTimerRef.current = null;
    }
  }, []);

  const startYtProgressTimer = useCallback(() => {
    stopYtProgressTimer();
    ytTimerRef.current = setInterval(() => {
      if (playbackEngineRef.current === 'youtube' && ytPlayerRef.current && ytPlayerRef.current.getCurrentTime) {
        try {
          const curr = ytPlayerRef.current.getCurrentTime() || 0;
          const dur = ytPlayerRef.current.getDuration() || 0;
          const loaded = ytPlayerRef.current.getVideoLoadedFraction() || 0;
          setCurrentTime(curr);
          if (dur > 0) setDuration(dur);
          setBufferedPercent(loaded * 100);
        } catch {
          // ignore
        }
      }
    }, 400);
  }, [stopYtProgressTimer]);

  const createYtPlayer = useCallback((vid, startSeconds = 0) => {
    if (!window.YT || !window.YT.Player) {
      return;
    }

    const cleanVid = extractVideoId(vid);
    if (!cleanVid) return;

    // Ensure slot element contains clean hidden player div
    const slot = document.getElementById('sodo-yt-player-slot');
    if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
      try {
        ytPlayerRef.current.destroy();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
      if (slot) {
        slot.innerHTML = '<div id="sodo-yt-hidden-player"></div>';
      }
    }

    setVideoError(null);

    try {
      ytPlayerRef.current = new window.YT.Player('sodo-yt-hidden-player', {
        height: '100%',
        width: '100%',
        videoId: cleanVid,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          fs: 1,
          iv_load_policy: 3,
          start: Math.floor(startSeconds) || 0,
        },
        events: {
          onReady: (event) => {
            event.target.setVolume(volumeRef.current || 80);
            if (playbackEngineRef.current === 'youtube') {
              try {
                event.target.playVideo();
              } catch {
                // ignore
              }
            }
          },
          onStateChange: (event) => {
            // YT.PlayerState.PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0
            if (playbackEngineRef.current === 'youtube') {
              if (event.data === 1) {
                setIsPlaying(true);
                setIsBuffering(false);
                setVideoError(null);
                startYtProgressTimer();
              } else if (event.data === 2) {
                setIsPlaying(false);
                stopYtProgressTimer();
              } else if (event.data === 3) {
                setIsBuffering(true);
              } else if (event.data === 0) {
                if (handleTrackEndedRef.current) handleTrackEndedRef.current();
              }
            }
          },
          onError: (e) => {
            console.warn('YouTube Player notice/error code:', e.data);
            let msg = 'Playback error occurred on YouTube video.';
            if (e.data === 150 || e.data === 101) {
              msg = 'The video owner has restricted embedding for this video.';
            } else if (e.data === 100) {
              msg = 'This video was removed or marked private on YouTube.';
            } else if (e.data === 2) {
              msg = 'Invalid YouTube video ID parameter.';
            } else if (e.data === 5) {
              msg = 'HTML5 player playback error occurred.';
            }
            setVideoError({ code: e.data, message: msg });
            setIsBuffering(false);
          },
        },
      });
    } catch (err) {
      console.warn('YT Player init failed:', err);
    }
  }, [startYtProgressTimer, stopYtProgressTimer]);

  // Load YouTube IFrame API script once (never init player without a valid videoId!)
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    window.onYouTubeIframeAPIReady = () => {
      isYtApiReadyRef.current = true;
      if (pendingVideoRef.current) {
        const { vid, startSeconds } = pendingVideoRef.current;
        pendingVideoRef.current = null;
        createYtPlayer(vid, startSeconds);
      }
    };

    if (window.YT && window.YT.Player) {
      isYtApiReadyRef.current = true;
      if (pendingVideoRef.current) {
        const { vid, startSeconds } = pendingVideoRef.current;
        pendingVideoRef.current = null;
        createYtPlayer(vid, startSeconds);
      }
    }

    return () => {
      if (ytTimerRef.current) clearInterval(ytTimerRef.current);
    };
  }, [createYtPlayer]);

  const seekTo = useCallback((seconds) => {
    setCurrentTime(seconds);
    if (playbackEngineRef.current === 'local' && audioRef.current) {
      audioRef.current.currentTime = seconds;
    } else if (ytPlayerRef.current && ytPlayerRef.current.seekTo) {
      ytPlayerRef.current.seekTo(seconds, true);
    }
  }, []);

  // Fallback to YouTube or video playback with optional start offset
  const playViaYouTube = useCallback((vid, startSeconds = 0) => {
    setPlaybackEngine('youtube');
    setVideoError(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    const cleanVid = extractVideoId(vid);
    if (!cleanVid) {
      console.warn('playViaYouTube called without a valid video ID:', vid);
      return;
    }

    if (!window.YT || !window.YT.Player) {
      pendingVideoRef.current = { vid: cleanVid, startSeconds };
      return;
    }

    if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      try {
        if (startSeconds > 0) {
          ytPlayerRef.current.loadVideoById({ videoId: cleanVid, startSeconds: Math.floor(startSeconds) });
        } else {
          ytPlayerRef.current.loadVideoById(cleanVid);
        }
        ytPlayerRef.current.playVideo();
      } catch (err) {
        console.warn('Error loading video by ID in YouTube player, re-creating:', err);
        createYtPlayer(cleanVid, startSeconds);
      }
    } else {
      createYtPlayer(cleanVid, startSeconds);
    }
  }, [createYtPlayer]);

  // Play a specific track with dual engine handling.
  // BY DEFAULT: Always plays in 'music' mode unless requestedMode === 'video'!
  const playTrack = useCallback(async (track, newQueue = null, requestedMode = 'music') => {
    if (!track) return;
    const cleanVid = extractVideoId(track);
    if (!cleanVid) return;

    const targetMode = requestedMode === 'video' ? 'video' : 'music';
    setPlayerMode(targetMode);
    setIsVideoExpanded(targetMode === 'video');

    setCurrentTrack(track);
    setIsPlaying(true);
    setCurrentTime(0);
    setIsBuffering(true);
    setBufferedPercent(0);
    setVideoError(null);

    if (newQueue && Array.isArray(newQueue)) {
      setQueue(newQueue);
      const idx = newQueue.findIndex((t) => extractVideoId(t) === cleanVid);
      setQueueIndex(idx >= 0 ? idx : 0);
    }

    // If explicit video mode requested, directly stream through YouTube video
    if (targetMode === 'video') {
      playViaYouTube(cleanVid, 0);
      return;
    }

    // Check backend download status
    try {
      const statusRes = await api.getSongStatus(cleanVid);
      if (statusRes && statusRes.status) {
        setDownloadStatus(statusRes.status);
      }
    } catch {
      setDownloadStatus('not_downloaded');
    }

    // Try HTML5 Audio stream from /api/songs/{cleanVid}/stream
    const audio = audioRef.current;
    if (audio) {
      const streamUrl = api.getStreamUrl(cleanVid);
      audio.pause();
      audio.src = streamUrl;
      audio.volume = isMuted ? 0 : volume / 100;
      audio.load();

      audio
        .play()
        .then(() => {
          // Successfully playing local stream!
          setPlaybackEngine('local');
          setIsBuffering(false);
          setIsPlaying(true);
          // Stop YT player
          if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
            ytPlayerRef.current.pauseVideo();
          }
        })
        .catch((err) => {
          // Error or 404 (file not downloaded yet) -> Fallback to YouTube in docked/background (music mode)
          console.log(`Local stream not playable for ${cleanVid} (${err.name}), using YouTube fallback.`);
          playViaYouTube(cleanVid, 0);
        });
    } else {
      playViaYouTube(cleanVid, 0);
    }
  }, [isMuted, volume, playViaYouTube]);

  const playVideo = useCallback((track, newQueue = null) => {
    return playTrack(track, newQueue, 'video');
  }, [playTrack]);

  // Next track logic
  const nextTrack = useCallback(() => {
    if (queue.length === 0) return;

    let nextIdx = queueIndex + 1;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (nextIdx >= queue.length) {
      if (repeatMode === 'all') {
        nextIdx = 0;
      } else {
        setIsPlaying(false);
        stopYtProgressTimer();
        return;
      }
    }

    setQueueIndex(nextIdx);
    playTrack(queue[nextIdx], null, playerMode);
  }, [queue, queueIndex, isShuffle, repeatMode, playerMode, playTrack, stopYtProgressTimer]);

  const handleTrackEnded = useCallback(() => {
    if (repeatMode === 'one') {
      seekTo(0);
      if (playbackEngine === 'local' && audioRef.current) {
        audioRef.current.play();
      } else if (ytPlayerRef.current && ytPlayerRef.current.playVideo) {
        ytPlayerRef.current.seekTo(0);
        ytPlayerRef.current.playVideo();
      }
      return;
    }
    nextTrack();
  }, [repeatMode, playbackEngine, seekTo, nextTrack]);

  useEffect(() => {
    handleTrackEndedRef.current = handleTrackEnded;
    nextTrackRef.current = nextTrack;
  }, [handleTrackEnded, nextTrack]);

  const prevTrack = useCallback(() => {
    if (queue.length === 0) return;

    if (currentTime > 3) {
      seekTo(0);
      return;
    }

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      prevIdx = queue.length - 1;
    }

    setQueueIndex(prevIdx);
    playTrack(queue[prevIdx], null, playerMode);
  }, [queue, queueIndex, currentTime, seekTo, playTrack, playerMode]);

  // Switch between 'music' (default) and 'video' playback modes
  const switchPlayerMode = (targetMode) => {
    if (targetMode === playerMode) return;

    if (targetMode === 'video') {
      setPlayerMode('video');
      setIsVideoExpanded(true);
      setVideoError(null);

      if (!currentTrack) return;
      const cleanVid = extractVideoId(currentTrack);
      if (!cleanVid) return;

      const wasPlaying = isPlaying;

      if (playbackEngine === 'local') {
        const currentPos = (audioRef.current && audioRef.current.currentTime) || currentTime || 0;
        if (audioRef.current) {
          audioRef.current.pause();
        }
        playViaYouTube(cleanVid, currentPos);
        if (!wasPlaying && ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
          setTimeout(() => {
            try {
              ytPlayerRef.current.pauseVideo();
              setIsPlaying(false);
            } catch {
              // ignore
            }
          }, 400);
        }
      } else if (ytPlayerRef.current) {
        if (wasPlaying && ytPlayerRef.current.playVideo) {
          ytPlayerRef.current.playVideo();
        }
      } else {
        playViaYouTube(cleanVid, currentTime || 0);
      }
    } else {
      setPlayerMode('music');
      setIsVideoExpanded(false);
      setVideoError(null);
    }
  };

  const togglePlayerMode = () => {
    switchPlayerMode(playerMode === 'music' ? 'video' : 'music');
  };

  // HTML5 Audio Event Listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (playbackEngine === 'local') {
        setCurrentTime(audio.currentTime);
        if (audio.duration && audio.duration > 0) {
          setDuration(audio.duration);
        }

        // Buffer calculation from TimeRanges
        if (audio.buffered.length > 0 && audio.duration > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
          setBufferedPercent((bufferedEnd / audio.duration) * 100);
        }
      }
    };

    const onLoadedMetadata = () => {
      if (playbackEngine === 'local' && audio.duration > 0) {
        setDuration(audio.duration);
        setIsBuffering(false);
      }
    };

    const onWaiting = () => {
      if (playbackEngine === 'local') {
        setIsBuffering(true);
      }
    };

    const onPlaying = () => {
      if (playbackEngine === 'local') {
        setIsBuffering(false);
        setIsPlaying(true);
      }
    };

    const onPause = () => {
      if (playbackEngine === 'local') {
        setIsPlaying(false);
      }
    };

    const onEnded = () => {
      if (playbackEngine === 'local') {
        handleTrackEnded();
      }
    };

    const onError = () => {
      if (playbackEngine === 'local' && currentTrack) {
        const cleanVid = extractVideoId(currentTrack);
        console.warn('HTML5 Audio encountered error on local stream. Falling back to YouTube.');
        playViaYouTube(cleanVid, (audio && audio.currentTime) || 0);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [playbackEngine, currentTrack, handleTrackEnded, playViaYouTube]);

  // Play an entire playlist/folder (defaults to 'music' mode)
  const playPlaylist = (title, trackList, startIndex = 0, requestedMode = 'music') => {
    if (!trackList || trackList.length === 0) return;
    setPlaylistTitle(title || 'Playlist');
    setQueue(trackList);
    setQueueIndex(startIndex);
    playTrack(trackList[startIndex], trackList, requestedMode);
  };

  const togglePlay = () => {
    if (!currentTrack) {
      if (queue.length > 0) {
        playTrack(queue[0]);
      }
      return;
    }

    if (isPlaying) {
      if (playbackEngine === 'local' && audioRef.current) {
        audioRef.current.pause();
      } else if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        ytPlayerRef.current.pauseVideo();
      }
      setIsPlaying(false);
      stopYtProgressTimer();
    } else {
      if (playbackEngine === 'local' && audioRef.current) {
        audioRef.current.play();
      } else if (ytPlayerRef.current && ytPlayerRef.current.playVideo) {
        ytPlayerRef.current.playVideo();
      }
      setIsPlaying(true);
      if (playbackEngine === 'youtube') {
        startYtProgressTimer();
      }
    }
  };


  const setVolume = (val) => {
    const clamped = Math.max(0, Math.min(100, val));
    setVolumeState(clamped);
    setIsMuted(clamped === 0);

    if (audioRef.current) {
      audioRef.current.volume = clamped / 100;
    }
    if (ytPlayerRef.current && ytPlayerRef.current.setVolume) {
      ytPlayerRef.current.setVolume(clamped);
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (audioRef.current) audioRef.current.muted = false;
      if (ytPlayerRef.current && ytPlayerRef.current.unMute) ytPlayerRef.current.unMute();
    } else {
      setIsMuted(true);
      if (audioRef.current) audioRef.current.muted = true;
      if (ytPlayerRef.current && ytPlayerRef.current.mute) ytPlayerRef.current.mute();
    }
  };

  const toggleShuffle = () => {
    setIsShuffle((prev) => !prev);
  };

  const toggleRepeat = () => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  };

  const toggleFavoriteTrack = async (trackId) => {
    try {
      const res = await api.toggleFavoritePlaylistItem(trackId);
      if (currentTrack && currentTrack.id === trackId) {
        setCurrentTrack((prev) => ({ ...prev, is_favorite: res.is_favorite ? 1 : 0 }));
      }
      setQueue((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, is_favorite: res.is_favorite ? 1 : 0 } : t))
      );
      return res.is_favorite;
    } catch (err) {
      console.error('Error toggling favorite:', err);
      return false;
    }
  };

  // Download the currently playing track for offline / local streaming
  const downloadCurrentTrack = async () => {
    if (!currentTrack) return null;
    const cleanVid = extractVideoId(currentTrack);
    if (!cleanVid) return null;
    try {
      setDownloadStatus('downloading');
      const res = await api.downloadSong(cleanVid);
      if (res.status === 'completed') {
        setDownloadStatus('completed');
      }
      return res;
    } catch (err) {
      console.error('Failed to download current track:', err);
      setDownloadStatus('not_downloaded');
      return null;
    }
  };

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
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
        playerMode, // 'music' (default) | 'video'
        videoTheaterMode,
        setVideoTheaterMode,
        setPlayerMode: switchPlayerMode,
        togglePlayerMode,
        playbackEngine, // 'local' | 'youtube'
        isBuffering,
        bufferedPercent,
        downloadStatus,
        videoError,
        playTrack,
        playVideo,
        playPlaylist,
        togglePlay,
        nextTrack,
        prevTrack,
        seekTo,
        setVolume,
        toggleMute,
        toggleShuffle,
        toggleRepeat,
        setIsQueueOpen,
        setIsVideoExpanded,
        toggleFavoriteTrack,
        downloadCurrentTrack,
      }}
    >
      {children}

      {/* HTML5 Audio element for local HTTP 206 range streaming */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

      {/* YouTube Iframe Player Container: Docked (Music Mode) vs Expanded (Video Mode) */}
      <div
        id="sodo-yt-player-container"
        className={`yt-docked-player ${isVideoExpanded ? 'expanded' : 'docked'} ${videoTheaterMode ? 'theater' : ''}`}
      >
        {isVideoExpanded && (
          <div className="yt-video-overlay-header">
            <div className="yt-video-header-left">
              <span className="yt-video-mode-tag">🎬 Video Mode</span>
              <div className="ytm-mode-switch-mini" role="tablist" aria-label="Playback Mode">
                <button
                  type="button"
                  className={`mode-mini-tab ${playerMode === 'music' ? 'active' : ''}`}
                  onClick={() => switchPlayerMode('music')}
                  title="Switch to Music Mode (Hide Video)"
                >
                  🎵 Song
                </button>
                <button
                  type="button"
                  className={`mode-mini-tab ${playerMode === 'video' ? 'active' : ''}`}
                  onClick={() => switchPlayerMode('video')}
                  title="Video Mode Active"
                >
                  🎬 Video
                </button>
              </div>
            </div>

            <div className="yt-video-header-right">
              <button
                type="button"
                className="yt-video-ctrl-btn"
                onClick={() => setVideoTheaterMode(!videoTheaterMode)}
                title={videoTheaterMode ? 'Exit Theater Mode' : 'Theater / Larger Mode'}
              >
                {videoTheaterMode ? '⤡ Normal' : '⤢ Theater'}
              </button>
              <button
                type="button"
                className="yt-video-ctrl-btn close"
                onClick={() => switchPlayerMode('music')}
                title="Switch back to Music Mode"
              >
                ✕ Close
              </button>
            </div>
          </div>
        )}

        <div className="yt-video-frame-wrapper">
          <div id="sodo-yt-player-slot">
            <div id="sodo-yt-hidden-player" />
          </div>
          {videoError && isVideoExpanded && (
            <div className="yt-video-error-fallback">
              <div style={{ fontSize: '32px', marginBottom: '4px' }}>⚠️</div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff' }}>
                {videoError.message}
              </div>
              <div style={{ fontSize: '12px', color: '#aaaaaa', maxWidth: '340px', lineHeight: '1.4' }}>
                {videoError.code === 150 || videoError.code === 101
                  ? 'YouTube restrictions prevent embedding this video on external sites.'
                  : 'Unable to stream this video through YouTube embedded player.'}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {currentTrack && (
                  <a
                    href={`https://www.youtube.com/watch?v=${extractVideoId(currentTrack)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ytm-btn-pill-small"
                    style={{ background: '#ff0000', color: '#ffffff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span>Watch on YouTube</span>
                    <span>↗</span>
                  </a>
                )}
                <button
                  type="button"
                  className="ytm-btn-pill-small"
                  onClick={() => switchPlayerMode('music')}
                  style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }}
                >
                  🎵 Music Mode
                </button>
                <button
                  type="button"
                  className="ytm-btn-pill-small"
                  onClick={nextTrack}
                  style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }}
                >
                  Next Track ⏭
                </button>
              </div>
            </div>
          )}
        </div>

        {isVideoExpanded && currentTrack && (
          <div className="yt-video-overlay-footer">
            <div className="yt-video-footer-title" title={currentTrack.title}>
              {currentTrack.title}
            </div>
            <div className="yt-video-footer-artist">
              {currentTrack.channel}
            </div>
          </div>
        )}
      </div>
    </PlayerContext.Provider>
  );
}

export { usePlayer } from './usePlayer';
