/**
 * Sodo Player API Client
 * Clean HTTP client for authentication endpoints with JWT handling.
 */

const TOKEN_KEY = 'sodo_auth_token';
const API_BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');

function formatUrl(endpoint) {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export const api = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  },

  setToken(token, remember = true) {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  },

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(formatUrl(endpoint), {
        ...options,
        headers,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401) {
          this.clearToken();
          window.dispatchEvent(new CustomEvent('sodo:unauthorized'));
        }

        let errorMessage = 'An unexpected error occurred.';
        if (data && data.detail) {
          if (Array.isArray(data.detail)) {
            // Pydantic validation error array
            errorMessage = data.detail.map((err) => err.msg).join(', ');
          } else {
            errorMessage = data.detail;
          }
        }
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Unable to connect to the backend server. Is it running on port 8000?');
      }
      throw err;
    }
  },

  async login(loginId, password, remember = true) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        login_id: loginId,
        password: password,
      }),
    });
    if (res.access_token) {
      this.setToken(res.access_token, remember);
    }
    return res;
  },

  async register({ email, username, password, fullName }, remember = true) {
    const res = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        username,
        password,
        full_name: fullName || null,
      }),
    });
    if (res.access_token) {
      this.setToken(res.access_token, remember);
    }
    return res;
  },

  async getMe() {
    return this.request('/api/auth/me', {
      method: 'GET',
    });
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore failure on logout
    } finally {
      this.clearToken();
    }
  },

  async searchYouTube(query, limit = 24) {
    const encoded = encodeURIComponent(query);
    return this.request(`/api/youtube/search?q=${encoded}&limit=${limit}`, {
      method: 'GET',
    });
  },

  async getTrendingYouTube(limit = 24) {
    return this.request(`/api/youtube/trending?limit=${limit}`, {
      method: 'GET',
    });
  },

  // Hierarchical Playlists / Folders API
  async getFolderContents(path = 'ALL', query = '') {
    const encodedPath = encodeURIComponent(path);
    const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
    return this.request(`/api/playlists/folder?path=${encodedPath}${qParam}`, {
      method: 'GET',
    });
  },

  async getFolderTree() {
    return this.request('/api/playlists/tree', {
      method: 'GET',
    });
  },

  async createFolder(path) {
    return this.request('/api/playlists/folders', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  async deleteFolder(path, deleteSongs = true) {
    const encoded = encodeURIComponent(path);
    return this.request(`/api/playlists/folders?path=${encoded}&delete_songs=${deleteSongs}`, {
      method: 'DELETE',
    });
  },

  async addPlaylistItem({ video_id, title, thumbnail, channel, duration, views, folder_path, is_favorite }) {
    return this.request('/api/playlists/items', {
      method: 'POST',
      body: JSON.stringify({
        video_id,
        title: title || 'Untitled Track',
        thumbnail: thumbnail || '',
        channel: channel || '',
        duration: duration || '',
        views: views || '',
        folder_path: folder_path || 'ALL',
        is_favorite: !!is_favorite,
      }),
    });
  },

  async removePlaylistItem(itemId) {
    return this.request(`/api/playlists/items/${itemId}`, {
      method: 'DELETE',
    });
  },

  async toggleFavoritePlaylistItem(itemId) {
    return this.request('/api/playlists/items/toggle-favorite', {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId }),
    });
  },

  async renameFolder(oldPath, newName, newPath) {
    return this.request('/api/playlists/folders/rename', {
      method: 'PUT',
      body: JSON.stringify({
        old_path: oldPath,
        new_name: newName || null,
        new_path: newPath || null,
      }),
    });
  },

  async moveFolder(sourcePath, newParentPath = '') {
    return this.request('/api/playlists/folders/move', {
      method: 'PUT',
      body: JSON.stringify({
        source_path: sourcePath,
        new_parent_path: newParentPath,
      }),
    });
  },

  async movePlaylistItem(itemId, targetFolderPath) {
    return this.request(`/api/playlists/items/${itemId}/move`, {
      method: 'PUT',
      body: JSON.stringify({
        target_folder_path: targetFolderPath,
      }),
    });
  },

  // Songs & Audio Streaming / Download
  getStreamUrl(songId) {
    return formatUrl(`/api/songs/${encodeURIComponent(songId)}/stream`);
  },

  async getSongStatus(songId) {
    return this.request(`/api/songs/${encodeURIComponent(songId)}/status`, {
      method: 'GET',
    });
  },

  async downloadSong(songId) {
    return this.request(`/api/songs/${encodeURIComponent(songId)}/download`, {
      method: 'POST',
    });
  },

  // User Data Export & Statistics
  async exportUserData(download = false) {
    if (download) {
      const token = this.getToken();
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(formatUrl('/api/user/data/export?download=true&pretty=true'), {
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to download user library data export.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      let filename = 'sodo_music_export.json';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      return { status: 'success', filename };
    }
    return this.request('/api/user/data/export', { method: 'GET' });
  },

  async getUserStats() {
    return this.request('/api/user/data/stats', { method: 'GET' });
  },

  async importUserData(data) {
    return this.request('/api/user/data/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
