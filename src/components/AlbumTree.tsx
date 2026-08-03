"use client";

import { FolderOpen, ChevronRight, ChevronDown, Image as ImageIcon, EyeOff, Lock, Printer, Upload } from "lucide-react";
import type { Album } from "@/data/mockData";

interface AlbumTreeProps {
  albums: Album[];
  activeAlbumId: string;
  onSelect: (id: string) => void;
  depth?: number;
  expandedIds?: Set<string>;
  onToggle?: (id: string) => void;
}

const AlbumTree = ({ albums, activeAlbumId, onSelect, depth = 0, expandedIds, onToggle }: AlbumTreeProps) => {
  return (
    <div className="space-y-0.5">
      {albums.map((album) => {
        const hasChildren = album.children && album.children.length > 0;
        const isExpanded = expandedIds?.has(album.id);
        const isActive = activeAlbumId === album.id;

        return (
          <div key={album.id}>
            <button
              type="button"
              onClick={() => onSelect(album.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle?.(album.id);
                  }}
                  className="shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-3.5" />
              )}
              {album.id === "all" ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              ) : album.kind === 'print' ? (
                <Printer className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{album.name}</span>
              {album.id !== 'all' && album.customerUploadEnabled ? <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
              {album.id !== 'all' && album.accessMode === 'password_protected' ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
              {album.id !== 'all' && album.accessMode === 'hidden' ? <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
              <span className="ml-auto text-xs text-muted-foreground">{album.photoCount}</span>
            </button>
            {hasChildren && isExpanded && (
              <AlbumTree
                albums={album.children!}
                activeAlbumId={activeAlbumId}
                onSelect={onSelect}
                depth={depth + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AlbumTree;
