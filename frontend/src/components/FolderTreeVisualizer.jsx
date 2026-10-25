import React, { useState, useMemo } from 'react';

// Depth color indicators for hierarchy levels
const DEPTH_COLORS = [
  '#3b82f6', // Depth 0 (Blue)
  '#10b981', // Depth 1 (Green)
  '#f59e0b', // Depth 2 (Amber)
  '#ec4899', // Depth 3 (Pink)
  '#8b5cf6', // Depth 4 (Purple)
  '#06b6d4', // Depth 5 (Cyan)
  '#f97316', // Depth 6 (Orange)
];

/**
 * Builds a hierarchical tree from flat folder array + system nodes.
 */
function buildFolderTree(folders, totalSongs = 0, favoriteSongs = 0) {
  const rootNodes = [];
  const folderMap = new Map();

  // 1. Root System Node: ALL
  const allNode = {
    id: 'system_all',
    path: 'ALL',
    name: 'ALL (Library)',
    icon: '🎵',
    isSystem: true,
    direct_count: totalSongs,
    recursive_count: totalSongs,
    depth: 0,
    children: [],
  };

  // 2. Root System Node: FAVORITES
  const favNode = {
    id: 'system_favorites',
    path: 'FAVORITES',
    name: 'FAVORITES',
    icon: '⭐',
    isSystem: true,
    direct_count: favoriteSongs,
    recursive_count: favoriteSongs,
    depth: 0,
    children: [],
  };

  rootNodes.push(allNode, favNode);

  // Index custom folders
  folders.forEach((f) => {
    folderMap.set(f.path, {
      ...f,
      depth: (f.path.match(/\//g) || []).length,
      children: [],
      icon: '📁',
    });
  });

  // Attach children to parents or to root
  folders.forEach((f) => {
    const node = folderMap.get(f.path);
    if (!f.parent_path) {
      rootNodes.push(node);
    } else {
      const parent = folderMap.get(f.parent_path);
      if (parent) {
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }
  });

  // Sort children alphabetically
  const sortChildren = (nodes) => {
    nodes.sort((a, b) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children && n.children.length > 0) {
        sortChildren(n.children);
      }
    });
  };

  sortChildren(rootNodes);
  return rootNodes;
}

/**
 * Recursive Tree Node Component
 */
function TreeNode({
  node,
  expandedPaths,
  toggleExpand,
  selectedPath,
  onSelectFolder,
  onPlayFolder,
  searchFilter,
  depth = 0,
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const depthColor = DEPTH_COLORS[depth % DEPTH_COLORS.length];

  const matchesSearch =
    searchFilter &&
    (node.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      node.path.toLowerCase().includes(searchFilter.toLowerCase()));

  return (
    <li className="tree-node-item">
      <div
        className={`tree-node-row ${isSelected ? 'selected' : ''} ${matchesSearch ? 'highlighted' : ''}`}
        style={{ '--depth-color': depthColor }}
      >
        {/* Toggle Arrow (only if has children) */}
        {hasChildren ? (
          <button
            type="button"
            className="tree-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.path);
            }}
            title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
          >
            <span className={`tree-arrow ${isExpanded ? 'open' : ''}`}>▶</span>
          </button>
        ) : (
          <span className="tree-arrow-spacer" />
        )}

        {/* Depth color pill indicator */}
        <span
          className="tree-depth-indicator"
          style={{ backgroundColor: depthColor }}
          title={`Depth level: ${depth}`}
        />

        {/* Node Content (Click navigates into folder) */}
        <div
          className="tree-node-content"
          onClick={() => onSelectFolder && onSelectFolder(node.path)}
          title={`Click to open: ${node.path}`}
        >
          <span className="tree-folder-icon">
            {node.isSystem ? node.icon : isExpanded ? '📂' : '📁'}
          </span>

          <span className="tree-folder-name">
            {node.name}
          </span>

          {/* Song Count Badges */}
          <div className="tree-badges">
            {node.recursive_count > 0 && (
              <span
                className="tree-badge total"
                title={`${node.recursive_count} total songs in this branch`}
              >
                {node.recursive_count} {node.recursive_count === 1 ? 'song' : 'songs'}
              </span>
            )}
            {!node.isSystem && node.children.length > 0 && node.direct_count > 0 && (
              <span
                className="tree-badge direct"
                title={`${node.direct_count} direct songs in this exact folder`}
              >
                {node.direct_count} direct
              </span>
            )}
          </div>
        </div>

        {/* Hover Quick Action: Play Folder */}
        <button
          type="button"
          className="tree-play-hover-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (onPlayFolder) onPlayFolder(node.path);
          }}
          title={`▶ Play all songs in "${node.path}"`}
        >
          ▶ Play
        </button>
      </div>

      {/* Children Subtree */}
      {hasChildren && isExpanded && (
        <ul className="tree-children-list">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
              selectedPath={selectedPath}
              onSelectFolder={onSelectFolder}
              onPlayFolder={onPlayFolder}
              searchFilter={searchFilter}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Flow Map Mode: Displays hierarchical paths as chaining breadcrumb cards
 */
function FlowMapView({ folders, selectedPath, onSelectFolder, onPlayFolder, searchFilter }) {
  // Group folders by their top-level root
  const groups = useMemo(() => {
    const map = new Map();
    // System groups
    map.set('SYSTEM', [
      { path: 'ALL', name: 'ALL (Library)', isSystem: true, recursive_count: 0, direct_count: 0 },
      { path: 'FAVORITES', name: 'FAVORITES', isSystem: true, recursive_count: 0, direct_count: 0 },
    ]);

    folders.forEach((f) => {
      const rootKey = f.path.split('/')[0];
      if (!map.has(rootKey)) {
        map.set(rootKey, []);
      }
      map.get(rootKey).push(f);
    });

    return Array.from(map.entries());
  }, [folders]);

  return (
    <div className="flow-map-container">
      {groups.map(([rootKey, items]) => {
        const filteredItems = items.filter((f) => {
          if (!searchFilter) return true;
          return f.path.toLowerCase().includes(searchFilter.toLowerCase());
        });

        if (filteredItems.length === 0) return null;

        return (
          <div key={rootKey} className="flow-branch-row">
            <div className="flow-branch-header">
              <span className="flow-root-badge">
                {rootKey === 'SYSTEM' ? '⭐ System Branches' : `📂 Root: ${rootKey}`}
              </span>
            </div>

            <div className="flow-cards-chain">
              {filteredItems.map((item, idx) => {
                const parts = item.path.split('/');
                const isSelected = selectedPath === item.path;
                const depth = parts.length - 1;
                const depthColor = DEPTH_COLORS[depth % DEPTH_COLORS.length];

                return (
                  <div key={item.path} className="flow-card-wrapper">
                    {idx > 0 && <span className="flow-connector-arrow">→</span>}
                    <div
                      className={`flow-card ${isSelected ? 'selected' : ''}`}
                      style={{ borderLeftColor: depthColor }}
                      onClick={() => onSelectFolder && onSelectFolder(item.path)}
                      title={`Open: ${item.path}`}
                    >
                      <div className="flow-card-top">
                        <span className="flow-card-icon">
                          {item.path === 'FAVORITES' ? '⭐' : item.path === 'ALL' ? '🎵' : '📁'}
                        </span>
                        <span className="flow-card-title">{item.name || item.path}</span>
                      </div>
                      <div className="flow-card-path">{item.path}</div>
                      <div className="flow-card-footer">
                        {item.recursive_count !== undefined && (
                          <span className="flow-card-count">
                            {item.recursive_count} tracks
                          </span>
                        )}
                        <button
                          type="button"
                          className="flow-card-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onPlayFolder) onPlayFolder(item.path);
                          }}
                          title={`Play ${item.path}`}
                        >
                          ▶ Play
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Main FolderTreeVisualizer Component
 */
export function FolderTreeVisualizer({
  folders = [],
  totalSongs = 0,
  favoriteSongs = 0,
  selectedPath = 'ALL',
  onSelectFolder,
  onPlayFolder,
  defaultViewMode = 'tree', // 'tree' | 'flow'
  compact = false,
}) {
  const [viewMode, setViewMode] = useState(defaultViewMode);
  const [searchFilter, setSearchFilter] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());

  // Build the hierarchical tree
  const treeRoots = useMemo(() => {
    return buildFolderTree(folders, totalSongs, favoriteSongs);
  }, [folders, totalSongs, favoriteSongs]);

  // Auto-expand nodes that match the search query
  const autoExpandedPaths = useMemo(() => {
    if (!searchFilter.trim()) return null;
    const q = searchFilter.toLowerCase();
    const matched = new Set();
    folders.forEach((f) => {
      if (f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) {
        const parts = f.path.split('/');
        let current = '';
        parts.forEach((p) => {
          current = current ? `${current}/${p}` : p;
          matched.add(current);
        });
      }
    });
    return matched;
  }, [searchFilter, folders]);

  const expandedPaths = useMemo(() => {
    return {
      has: (path) => {
        if (autoExpandedPaths && autoExpandedPaths.has(path)) {
          return true;
        }
        return !collapsedPaths.has(path);
      },
    };
  }, [autoExpandedPaths, collapsedPaths]);

  const toggleExpand = (path) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedPaths(new Set());
  };

  const collapseAll = () => {
    const all = new Set();
    folders.forEach((f) => all.add(f.path));
    all.add('ALL');
    all.add('FAVORITES');
    setCollapsedPaths(all);
  };

  return (
    <div className={`folder-tree-visualizer ${compact ? 'compact' : ''}`}>
      {/* Header with Search and Mode Switcher */}
      <div className="tree-vis-header">
        <div className="tree-vis-title-col">
          <div className="tree-vis-title">
            <span>🌲</span>
            <span>Library Tree Visualizer</span>
          </div>
          <span className="tree-vis-subtitle">
            {folders.length} hierarchical folders • {totalSongs} total songs
          </span>
        </div>

        {/* View Mode Toggle & Expand Controls */}
        <div className="tree-vis-actions">
          <div className="tree-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => setViewMode('tree')}
              title="Tree Hierarchy View"
            >
              <span>🌲</span> Tree Hierarchy
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === 'flow' ? 'active' : ''}`}
              onClick={() => setViewMode('flow')}
              title="Flow Map View"
            >
              <span>🗺️</span> Flow Map
            </button>
          </div>

          {viewMode === 'tree' && (
            <div className="tree-expand-controls">
              <button
                type="button"
                className="tree-util-btn"
                onClick={expandAll}
                title="Expand All Folders"
              >
                Expand All
              </button>
              <button
                type="button"
                className="tree-util-btn"
                onClick={collapseAll}
                title="Collapse All Folders"
              >
                Collapse All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search Filter Input */}
      <div className="tree-vis-search-bar">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="search-icon"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="tree-search-input"
          placeholder="Filter folders and paths (e.g. ANIME, 2010, WINTER)..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        {searchFilter && (
          <button
            type="button"
            className="tree-search-clear"
            onClick={() => setSearchFilter('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Main View Area */}
      <div className="tree-vis-body">
        {viewMode === 'tree' ? (
          <div className="tree-container">
            <ul className="tree-root-list">
              {treeRoots.map((rootNode) => (
                <TreeNode
                  key={rootNode.path}
                  node={rootNode}
                  expandedPaths={expandedPaths}
                  toggleExpand={toggleExpand}
                  selectedPath={selectedPath}
                  onSelectFolder={onSelectFolder}
                  onPlayFolder={onPlayFolder}
                  searchFilter={searchFilter}
                  depth={0}
                />
              ))}
            </ul>
          </div>
        ) : (
          <FlowMapView
            folders={folders}
            selectedPath={selectedPath}
            onSelectFolder={onSelectFolder}
            onPlayFolder={onPlayFolder}
            searchFilter={searchFilter}
          />
        )}
      </div>
    </div>
  );
}
