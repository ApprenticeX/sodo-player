// Package sodo provides Go struct types and import helpers for Sodo Player user data exports.
// Use this file when migrating the Sodo Player backend to Go.
package sodo

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// UserExportProfile represents the authenticated user's profile info.
type UserExportProfile struct {
	ID        string    `json:"id" db:"id"`
	Username  string    `json:"username" db:"username"`
	Email     string    `json:"email" db:"email"`
	FullName  string    `json:"full_name" db:"display_name"`
	CreatedAt *time.Time `json:"created_at,omitempty" db:"created_at"`
}

// FolderExportItem represents a hierarchical folder entry.
type FolderExportItem struct {
	ID         string     `json:"id" db:"id"`
	UserID     string     `json:"user_id" db:"user_id"`
	Path       string     `json:"path" db:"path"`
	Name       string     `json:"name" db:"name"`
	ParentPath string     `json:"parent_path" db:"parent_path"`
	CreatedAt  *time.Time `json:"created_at,omitempty" db:"created_at"`
}

// PlaylistItemExportItem represents a song track inside a folder or playlist.
type PlaylistItemExportItem struct {
	ID               string     `json:"id" db:"id"`
	UserID           string     `json:"user_id" db:"user_id"`
	VideoID          string     `json:"video_id" db:"video_id"`
	Title            string     `json:"title" db:"title"`
	Thumbnail        string     `json:"thumbnail" db:"thumbnail"`
	Channel          string     `json:"channel" db:"channel"`
	Duration         string     `json:"duration" db:"duration"`
	Views            string     `json:"views" db:"views"`
	FolderPath       string     `json:"folder_path" db:"folder_path"`
	IsFavorite       bool       `json:"is_favorite" db:"is_favorite"`
	DownloadStatus   string     `json:"download_status" db:"download_status"`
	LocalFile        string     `json:"local_file" db:"local_file"`
	DownloadProgress float64    `json:"download_progress" db:"download_progress"`
	LastAccessed     *time.Time `json:"last_accessed,omitempty" db:"last_accessed"`
	AddedAt          *time.Time `json:"added_at,omitempty" db:"added_at"`
}

// ExportStats represents summary statistics for the export package.
type ExportStats struct {
	TotalFolders    int `json:"total_folders"`
	TotalSongs      int `json:"total_songs"`
	TotalFavorites  int `json:"total_favorites"`
	DownloadedSongs int `json:"downloaded_songs"`
}

// UserDataExportResponse represents the complete bundle exported by GET /api/user/data/export.
type UserDataExportResponse struct {
	Version       string                   `json:"version"`
	System        string                   `json:"system"`
	Format        string                   `json:"format"`
	ExportedAt    time.Time                `json:"exported_at"`
	User          UserExportProfile        `json:"user"`
	Stats         ExportStats              `json:"stats"`
	Folders       []FolderExportItem       `json:"folders"`
	PlaylistItems []PlaylistItemExportItem `json:"playlist_items"`
}

// LoadExportFile reads and unmarshals a Sodo Player export JSON file in Go.
func LoadExportFile(filepath string) (*UserDataExportResponse, error) {
	bytes, err := os.ReadFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to read export file: %w", err)
	}

	var export UserDataExportResponse
	if err := json.Unmarshal(bytes, &export); err != nil {
		return nil, fmt.Errorf("failed to parse export json: %w", err)
	}

	return &export, nil
}

// PostgresSQLSchema contains the PostgreSQL DDL statements matching this data structure.
const PostgresSQLSchema = `
-- Folders table
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_path TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uniq_folders_user_path UNIQUE(user_id, path)
);
CREATE INDEX IF NOT EXISTS idx_folders_user_path ON folders(user_id, path);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_path);

-- Playlist Items table
CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    channel TEXT NOT NULL,
    duration TEXT NOT NULL DEFAULT '',
    views TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    download_status TEXT NOT NULL DEFAULT 'not_downloaded',
    local_file TEXT DEFAULT '',
    download_progress REAL DEFAULT 0.0,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uniq_items_user_video UNIQUE(user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_items_user_folder ON playlist_items(user_id, folder_path);
CREATE INDEX IF NOT EXISTS idx_items_user_fav ON playlist_items(user_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_items_user_video ON playlist_items(user_id, video_id);
`
