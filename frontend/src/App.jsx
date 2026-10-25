import React, { useState, useEffect } from 'react';
import { api } from './api';
import { LoginForm } from './components/LoginForm';
import { Dashboard } from './components/Dashboard';
import { YTSearchPage } from './components/YTSearchPage';
import { PlaylistsPage } from './components/PlaylistsPage';
import { HomePage } from './components/HomePage';
import { PlayerProvider } from './context/PlayerContext';
import { MusicPlayerBar } from './components/MusicPlayerBar';
import { Navbar } from './components/Navbar';

export default function App() {
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [currentPage, setCurrentPage] = useState(() => {
    const path = window.location.pathname;
    const search = window.location.search;
    if (path.includes('playlists') || path.includes('folders')) {
      return 'playlists';
    }
    if (path.includes('yt-search') || search.includes('q=') || search.includes('search=')) {
      return 'yt-search';
    }
    if (path.includes('dashboard')) {
      return 'dashboard';
    }
    if (path.includes('login')) {
      return 'login';
    }
    // Main home page is a professional music player!
    return 'home';
  });

  // Restore authenticated session on page load
  useEffect(() => {
    const verifySession = async () => {
      const token = api.getToken();
      if (!token) {
        setIsCheckingAuth(false);
        return;
      }

      try {
        const userData = await api.getMe();
        setUser(userData);
      } catch {
        api.clearToken();
        setUser(null);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    verifySession();
  }, []);

  // Listen for browser popstate
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const search = window.location.search;
      if (path.includes('playlists') || path.includes('folders')) {
        setCurrentPage('playlists');
      } else if (path.includes('yt-search') || search.includes('q=')) {
        setCurrentPage('yt-search');
      } else if (path.includes('dashboard')) {
        setCurrentPage('dashboard');
      } else if (path.includes('login')) {
        setCurrentPage('login');
      } else {
        setCurrentPage('home');
      }
    };

    const handleUnauthorized = () => {
      setUser(null);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('sodo:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('sodo:unauthorized', handleUnauthorized);
    };
  }, []);

  const handleNavigate = (pageName) => {
    setCurrentPage(pageName);
    const newUrl = new URL(window.location.href);
    if (pageName === 'home') {
      newUrl.pathname = '/';
      newUrl.search = '';
      window.history.pushState(null, '', newUrl.toString());
    } else if (pageName === 'playlists') {
      newUrl.pathname = '/playlists';
      window.history.pushState(null, '', newUrl.toString());
    } else if (pageName === 'yt-search') {
      newUrl.pathname = '/yt-search';
      window.history.pushState(null, '', newUrl.toString());
    } else if (pageName === 'dashboard') {
      newUrl.pathname = '/dashboard';
      newUrl.search = '';
      window.history.pushState(null, '', newUrl.toString());
    } else if (pageName === 'login') {
      newUrl.pathname = '/login';
      newUrl.search = '';
      window.history.pushState(null, '', newUrl.toString());
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    handleNavigate('home');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    handleNavigate('home');
  };

  if (isCheckingAuth) {
    return (
      <div className="app-loader">
        <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }} />
        <span className="app-loader-text">Loading session...</span>
      </div>
    );
  }

  // Routing renderer
  const renderCurrentPage = () => {
    if (currentPage === 'login') {
      return (
        <div className="ytm-app-layout">
          <Navbar currentPage="login" onNavigate={handleNavigate} />
          <div className="ytm-auth-container">
            <LoginForm onLoginSuccess={handleLoginSuccess} />
          </div>
        </div>
      );
    }

    if (currentPage === 'dashboard' && user) {
      return (
        <Dashboard
          user={user}
          onLogout={handleLogout}
          onNavigate={handleNavigate}
        />
      );
    }

    if (currentPage === 'playlists') {
      return (
        <PlaylistsPage
          user={user}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
      );
    }

    if (currentPage === 'yt-search') {
      return (
        <YTSearchPage
          user={user}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
      );
    }

    // Default Main Page: Professional Music Player Home Page!
    return (
      <HomePage
        user={user}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />
    );
  };

  return (
    <PlayerProvider>
      <div className="app-main-viewport">
        {renderCurrentPage()}
        {/* Sticky Professional Bottom Music Player Bar */}
        <MusicPlayerBar onNavigate={handleNavigate} user={user} />
      </div>
    </PlayerProvider>
  );
}
