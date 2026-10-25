import React, { useState, useEffect } from 'react';
import { api } from '../api';

export function AddToPlaylistModal({ video, user, onClose, onSuccess, onNavigate }) {
  const isLoggedIn = user || !!api.getToken();
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [subfolderInput, setSubfolderInput] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [downloadOffline, setDownloadOffline] = useState(true); // Default checked for best offline playback!
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    const loadFolders = async () => {
      try {
        const data = await api.getFolderTree();
        // Filter out system virtual roots like 'ALL' or 'FAVORITES' so user picks real folders
        const folderList = (data.folders || [])
          .map((f) => f.path)
          .filter((p) => p !== 'ALL' && p !== 'FAVORITES');

        setFolders(folderList);
        if (folderList.length > 0) {
          setSelectedFolder(folderList[0]);
        } else {
          setSelectedFolder('__NEW_ROOT__');
        }
      } catch (err) {
        console.error('Failed to load folders:', err);
      }
    };
    loadFolders();
  }, [isLoggedIn]);

  // Compute target path based on selected base folder + typed subfolder
  const getComputedTargetPath = () => {
    const isNewRoot = selectedFolder === '__NEW_ROOT__' || !selectedFolder;
    const base = !isNewRoot ? selectedFolder.trim().replace(/^\/+|\/+$/g, '') : '';
    const sub = subfolderInput.trim().replace(/^\/+|\/+$/g, '');

    if (base && sub) {
      // Goes deeper than the selected base folder (e.g. ANIME + /NEW -> ANIME/NEW)
      return `${base}/${sub}`.toUpperCase();
    }
    if (base && !sub) {
      return base.toUpperCase();
    }
    if (!base && sub) {
      // New custom root folder/path without any prefix
      return sub.toUpperCase();
    }
    return '';
  };

  const computedPath = getComputedTargetPath();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!computedPath) {
      setError('Please select a folder or type a new folder path.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const vid = video.id || video.video_id;

    try {
      // 1. Add item to hierarchical playlist folder
      await api.addPlaylistItem({
        video_id: vid,
        title: video.title,
        thumbnail: video.thumbnail,
        channel: video.channel,
        duration: video.duration || '',
        views: video.views || '',
        folder_path: computedPath,
        is_favorite: isFavorite,
      });

      // 2. If user selected download for offline / local streaming, trigger download
      if (downloadOffline && vid) {
        api.downloadSong(vid).catch((dlErr) => {
          console.warn('Background download triggered notice:', dlErr);
        });
      }

      if (onSuccess) {
        onSuccess(computedPath);
      }
      onClose();
    } catch (err) {
      console.error('Add to playlist error:', err);
      setError(err.message || 'Failed to add video to playlist.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="yt-modal-backdrop" onClick={onClose}>
      <div className="yt-modal-content folder-modal" onClick={(e) => e.stopPropagation()}>
        <div className="yt-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📁</span>
            <h4 className="yt-modal-title">Add to Hierarchical Playlist</h4>
          </div>
          <button type="button" className="yt-modal-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!isLoggedIn ? (
          <div className="folder-modal-body" style={{ textAlign: 'center', padding: '36px 20px' }}>
            <div style={{ fontSize: '44px', marginBottom: '14px' }}>🔒</div>
            <h4 style={{ fontSize: '19px', fontWeight: '700', marginBottom: '10px', color: '#fff' }}>
              Sign in to Save Songs
            </h4>
            <p style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px', maxWidth: '360px', margin: '0 auto 24px' }}>
              Playlists are account-specific. Please sign in or register to save "{video.title}" to your personal folders.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button type="button" className="yt-nav-btn yt-nav-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="yt-nav-btn yt-nav-btn-primary"
                onClick={() => {
                  onClose();
                  if (onNavigate) onNavigate('login');
                }}
              >
                Sign In / Register
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="folder-modal-body">
          {/* Video preview mini banner */}
          <div className="folder-video-preview">
            <img src={video.thumbnail} alt={video.title} className="folder-preview-thumb" />
            <div className="folder-preview-meta">
              <div className="folder-preview-title">{video.title}</div>
              <div className="folder-preview-channel">{video.channel}</div>
            </div>
          </div>

          {error && <div className="folder-modal-error">{error}</div>}

          {/* 1. Base Folder Selection */}
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontSize: '13px', color: '#aaaaaa', display: 'block', marginBottom: '6px' }}>
              Select Base Folder:
            </label>
            <select
              className="folder-select-input"
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
            >
              {folders.map((f) => (
                <option key={f} value={f}>
                  📂 {f}
                </option>
              ))}
              <option value="__NEW_ROOT__">✨ + Create New Root Folder...</option>
            </select>
          </div>

          {/* 2. Deeper Subfolder Input */}
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontSize: '13px', color: '#aaaaaa', display: 'block', marginBottom: '6px' }}>
              {selectedFolder === '__NEW_ROOT__'
                ? 'Type New Folder Path (use / for subfolders):'
                : `Type Subpath to Go Deeper inside "${selectedFolder}":`}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
              <input
                type="text"
                className="folder-text-input"
                placeholder={
                  selectedFolder === '__NEW_ROOT__'
                    ? 'e.g. JPOP/ANIME or SOUNDTRACKS'
                    : 'e.g. /NEW or /2010/WINTER'
                }
                value={subfolderInput}
                onChange={(e) => setSubfolderInput(e.target.value)}
              />
            </div>
            <span style={{ fontSize: '11px', color: '#888888', marginTop: '4px', display: 'block' }}>
              {selectedFolder !== '__NEW_ROOT__'
                ? 'Typing /something goes deeper into the selected base folder (e.g. ANIME/NEW, never ALL/...).'
                : 'Each slash / creates a nested hierarchical folder.'}
            </span>
          </div>

          {/* 3. Live Target Path Preview Banner */}
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: '12.5px', color: '#aaaaaa' }}>Target Folder:</span>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '13px',
                fontWeight: '700',
                color: '#ffffff',
                background: 'rgba(255, 0, 0, 0.15)',
                border: '1px solid rgba(255, 0, 0, 0.3)',
                padding: '3px 8px',
                borderRadius: '6px',
              }}
            >
              📂 {computedPath || '(None selected)'}
            </span>
          </div>

          {/* 4. Options: Offline Download & Favorite Checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#f1f1f1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={downloadOffline}
                onChange={(e) => setDownloadOffline(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <span>📥 Download audio for offline/local streaming (HTTP 206)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#f1f1f1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              <span>⭐ Mark as Favorite</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="yt-nav-btn yt-nav-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="yt-nav-btn yt-nav-btn-primary"
              disabled={isSubmitting || !computedPath}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span>{isSubmitting ? 'Saving...' : 'Save to Playlist'}</span>
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
