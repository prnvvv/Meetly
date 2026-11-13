"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { VideoTile } from "@/components/meeting/VideoTile";
import { useElementSize } from "@/hooks/useElementSize";
import type { RoomLayoutMode } from "@/hooks/useRoomPreferences";
import { fitGrid, lastRowStart, pageSlice } from "@/lib/gridLayout";
import { cx } from "@/lib/utils";

export interface StageTile {
  id: number;
  name: string;
  isMuted: boolean;
  isHost: boolean;
  isVideoOn: boolean;
  stream: MediaStream | null;
  reactions: string[];
  isSelf: boolean;
  /** Real uploaded profile photo, when the participant has one. */
  imageUrl?: string | null;
}

/** Shape of a camera-off (avatar) tile when others are present. */
const AVATAR_TILE_ASPECT = 16 / 9;

interface ParticipantGridProps {
  tiles: StageTile[];
  layout: RoomLayoutMode;
  activeSpeakerId: number | null;
  pinnedId: number | null;
  mirroredSelf: boolean;
  /** Shown on the only tile while its camera is off ("waiting for others"). */
  soloHint?: ReactNode;
  /** Hover menu rendered inside each tile. */
  renderMenu?: (tile: StageTile) => ReactNode;
}

function pickMain(
  tiles: StageTile[],
  activeSpeakerId: number | null,
  pinnedId: number | null
): StageTile | null {
  if (pinnedId !== null) {
    const pinned = tiles.find((tile) => tile.id === pinnedId);
    if (pinned) return pinned;
  }
  if (activeSpeakerId !== null) {
    const speaker = tiles.find((tile) => tile.id === activeSpeakerId);
    if (speaker) return speaker;
  }
  return tiles.find((tile) => !tile.isSelf) ?? tiles[0] ?? null;
}

/**
 * The meeting stage: gallery grid or speaker view.
 * Every mode re-fits from the measured stage size, so tiles never overlap the
 * toolbar and never overflow the viewport.
 */
export function ParticipantGrid({
  tiles,
  layout,
  activeSpeakerId,
  pinnedId,
  mirroredSelf,
  renderMenu,
  soloHint,
}: ParticipantGridProps) {
  const [stageRef, size] = useElementSize<HTMLDivElement>();
  const [page, setPage] = useState(0);
  // Real video aspect ratio per participant, reported by each tile. Updated
  // only when a value actually changes, so layout never causes render loops.
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const reportAspect = useCallback((id: number, aspect: number | null) => {
    setAspects((current) => {
      const previous = current[id];
      if (aspect === null) {
        if (previous === undefined) return current;
        const rest = { ...current };
        delete rest[id];
        return rest;
      }
      if (previous !== undefined && Math.abs(previous - aspect) < 0.001) return current;
      return { ...current, [id]: aspect };
    });
  }, []);

  const mode: "gallery" | "speaker" = useMemo(() => {
    if (layout === "gallery") return "gallery";
    if (layout === "speaker") return "speaker";
    // auto
    if (pinnedId !== null && tiles.some((tile) => tile.id === pinnedId)) {
      return "speaker";
    }
    if (activeSpeakerId !== null && tiles.length > 1) return "speaker";
    return "gallery";
  }, [layout, pinnedId, activeSpeakerId, tiles]);

  const focused =
    mode === "speaker"
      ? pickMain(tiles, activeSpeakerId, pinnedId)
      : null;
  const focusedId = focused?.id ?? null;
  const filmstrip = focused ? tiles.filter((tile) => tile.id !== focusedId) : tiles;

  // Camera-off tiles in a multi-person room are landscape cards; alone, the
  // single tile is the waiting canvas and fills the stage.
  const fallbackAspect = tiles.length > 1 ? AVATAR_TILE_ASPECT : null;

  const fit = useMemo(
    () =>
      fitGrid(tiles.length, size.width, size.height, {
        aspects: tiles.map((tile) => aspects[tile.id] ?? fallbackAspect),
      }),
    [tiles, aspects, fallbackAspect, size.width, size.height]
  );

  // The page index is clamped on read, so shrinking tile counts can never
  // leave the grid pointing past the last page.
  const safePage = Math.min(page, Math.max(0, fit.pageCount - 1));
  const { visible } = pageSlice(tiles, safePage, fit);
  const centerStart = lastRowStart(visible.length, fit.columns);

  const renderTile = (tile: StageTile, extraClass?: string) => (
    <VideoTile
      key={tile.id}
      name={tile.isSelf ? (tile.isHost ? "You (Host)" : "You") : tile.name}
      isMuted={tile.isMuted}
      isHost={tile.isHost}
      speaking={tile.id === activeSpeakerId}
      stream={tile.stream}
      isVideoOn={tile.isVideoOn}
      videoMuted // audio is played by <RemoteAudio/>; the tile video is picture-only
      mirrored={tile.isSelf && mirroredSelf}
      isPinned={tile.id === pinnedId}
      reactions={tile.reactions}
      avatarVariant={tile.id > 0 ? tile.id : undefined}
      avatarImageUrl={tile.imageUrl}
      onAspectChange={(aspect) => reportAspect(tile.id, aspect)}
      fallbackAspect={fallbackAspect ?? undefined}
      placeholderExtra={tiles.length === 1 ? soloHint : undefined}
      menu={renderMenu?.(tile)}
      className={cx(extraClass, tiles.length === 1 && "tile--solo")}
    />
  );

  if (tiles.length === 0) {
    return (
      <div className="stage stage--empty" ref={stageRef}>
        <div className="stage__empty">
          <div className="stage__empty-title">Waiting for others…</div>
          <div className="stage__empty-text">
            Share your invite link so people can join this meeting.
          </div>
        </div>
      </div>
    );
  }

  if (focused) {
    const stripVertical = size.width >= 900;
    return (
      <div
        className={cx(
          "stage stage--focus",
          stripVertical ? "stage--focus-side" : "stage--focus-bottom"
        )}
        ref={stageRef}
      >
        <div className="stage__main">{renderTile(focused, "tile--featured")}</div>
        {filmstrip.length > 0 ? (
          <div className="stage__filmstrip" role="list">
            {filmstrip.map((tile) => renderTile(tile))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stage" ref={stageRef}>
      <div
        className="stage__grid"
        style={{
          gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${fit.rows}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((tile, index) => {
          const remainder = visible.length % fit.columns;
          const lastRowOffset = visible.length - remainder;
          const style =
            remainder !== 0 && index >= lastRowOffset
              ? { gridColumnStart: centerStart + (index - lastRowOffset) }
              : undefined;
          return (
            <div key={tile.id} className="stage__cell" style={style}>
              {renderTile(tile)}
            </div>
          );
        })}
      </div>

      {fit.pageCount > 1 ? (
        <div className="stage__pager">
          <button
            type="button"
            className="stage__pager-button"
            aria-label="Previous page of participants"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeftIcon size={16} />
          </button>
          <span className="stage__pager-label">
            {safePage + 1} / {fit.pageCount}
          </span>
          <button
            type="button"
            className="stage__pager-button"
            aria-label="Next page of participants"
            disabled={safePage >= fit.pageCount - 1}
            onClick={() => setPage((current) => current + 1)}
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
