"""
AudioStrike — pygame-native file browser.

Presents a scrollable directory listing so the user can pick audio files
without needing tkinter or any external GUI toolkit.
"""

import os
import pygame
from constants import *

AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"}

# Colors specific to the file picker
_BG        = (10,  12,  28)
_HEADER    = (  0, 200, 240)
_DIR_COL   = (120, 180, 255)
_FILE_COL  = (220, 220, 220)
_AUDIO_COL = (  0, 230, 120)
_SEL_BG    = ( 40,  60, 100)
_SEL_FG    = (255, 255, 255)
_DIM       = ( 90,  90, 120)
_BORDER    = ( 50,  70, 130)


def _list_dir(path: str) -> list[tuple[str, bool]]:
    """
    Return sorted (name, is_dir) entries for *path*.
    Prepends ".." if not at filesystem root.
    """
    entries: list[tuple[str, bool]] = []
    try:
        for name in sorted(os.listdir(path), key=lambda n: n.lower()):
            full = os.path.join(path, name)
            entries.append((name, os.path.isdir(full)))
    except PermissionError:
        pass

    # Only show audio files and directories
    entries = [
        (n, d) for n, d in entries
        if d or os.path.splitext(n)[1].lower() in AUDIO_EXTS
    ]

    if os.path.dirname(path) != path:   # not at root
        entries.insert(0, ("..", True))

    return entries


def pick_audio_file(screen: pygame.Surface, title: str) -> str | None:
    """
    Run a blocking pygame file-browser loop and return the chosen audio
    file path, or None if the user cancels (ESC).

    *screen* is the already-initialised pygame display surface.
    """
    clock  = pygame.time.Clock()
    font_t = pygame.font.SysFont("monospace", 20, bold=True)
    font_s = pygame.font.SysFont("monospace", 16)
    font_h = pygame.font.SysFont("monospace", 13)

    # Start in the user's home directory
    cwd     = os.path.expanduser("~")
    entries : list[tuple[str, bool]] = []
    sel     = 0
    scroll  = 0

    ROW_H      = 28
    LIST_TOP   = 130
    LIST_BOT   = SCREEN_H - 80
    VISIBLE    = (LIST_BOT - LIST_TOP) // ROW_H

    def reload():
        nonlocal entries, sel, scroll
        entries = _list_dir(cwd)
        sel     = 0
        scroll  = 0

    reload()

    while True:
        # ── Events ────────────────────────────────────────────────────────────
        for evt in pygame.event.get():
            if evt.type == pygame.QUIT:
                pygame.quit()
                import sys; sys.exit()

            if evt.type == pygame.KEYDOWN:
                if evt.key == pygame.K_ESCAPE:
                    return None

                elif evt.key == pygame.K_UP:
                    sel = max(0, sel - 1)
                    if sel < scroll:
                        scroll = sel

                elif evt.key == pygame.K_DOWN:
                    sel = min(len(entries) - 1, sel + 1)
                    if sel >= scroll + VISIBLE:
                        scroll = sel - VISIBLE + 1

                elif evt.key == pygame.K_PAGEUP:
                    sel    = max(0, sel - VISIBLE)
                    scroll = max(0, scroll - VISIBLE)

                elif evt.key == pygame.K_PAGEDOWN:
                    sel    = min(len(entries) - 1, sel + VISIBLE)
                    scroll = min(max(0, len(entries) - VISIBLE), scroll + VISIBLE)

                elif evt.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
                    if not entries:
                        continue
                    name, is_dir = entries[sel]
                    full = os.path.normpath(os.path.join(cwd, name))
                    if is_dir:
                        cwd = full
                        reload()
                    else:
                        return full

            # Mouse wheel scroll
            if evt.type == pygame.MOUSEWHEEL:
                scroll = max(0, min(max(0, len(entries) - VISIBLE),
                                    scroll - evt.y))

            # Mouse click
            if evt.type == pygame.MOUSEBUTTONDOWN and evt.button == 1:
                mx, my = evt.pos
                if LIST_TOP <= my < LIST_BOT:
                    clicked = scroll + (my - LIST_TOP) // ROW_H
                    if 0 <= clicked < len(entries):
                        if clicked == sel:
                            # Double-click logic: second click on same item = confirm
                            name, is_dir = entries[sel]
                            full = os.path.normpath(os.path.join(cwd, name))
                            if is_dir:
                                cwd = full
                                reload()
                            else:
                                return full
                        else:
                            sel = clicked

        # ── Draw ──────────────────────────────────────────────────────────────
        screen.fill(_BG)

        # Title bar
        pygame.draw.rect(screen, _BORDER, (0, 0, SCREEN_W, 50))
        t = font_t.render(f"  {title}", True, _HEADER)
        screen.blit(t, (10, 14))

        # Current path
        path_surf = font_h.render(f"  {cwd}", True, _DIM)
        screen.blit(path_surf, (10, 60))

        # Column headers
        pygame.draw.line(screen, _BORDER, (0, 85), (SCREEN_W, 85), 1)
        hdr = font_h.render("  NAME                                          TYPE", True, _DIM)
        screen.blit(hdr, (10, 90))
        pygame.draw.line(screen, _BORDER, (0, 110), (SCREEN_W, 110), 1)

        # Help bar at bottom
        pygame.draw.rect(screen, _BORDER, (0, SCREEN_H - 50, SCREEN_W, 50))
        help_t = font_h.render(
            "  ↑ ↓  navigate   Enter  select / open   PgUp PgDn  scroll   ESC  cancel",
            True, _DIM)
        screen.blit(help_t, (10, SCREEN_H - 35))

        # Separator
        pygame.draw.line(screen, _BORDER, (0, LIST_BOT), (SCREEN_W, LIST_BOT), 1)

        # File list
        visible_entries = entries[scroll: scroll + VISIBLE + 1]
        for i, (name, is_dir) in enumerate(visible_entries):
            abs_i  = scroll + i
            row_y  = LIST_TOP + i * ROW_H
            is_sel = abs_i == sel

            # Selection highlight
            if is_sel:
                pygame.draw.rect(screen, _SEL_BG,
                                 (0, row_y, SCREEN_W, ROW_H))

            # Icon + colour
            if name == "..":
                icon = "←"
                col  = _DIR_COL
                kind = "parent dir"
            elif is_dir:
                icon = "▶"
                col  = _DIR_COL
                kind = "folder"
            else:
                icon = "♪"
                col  = _AUDIO_COL
                ext  = os.path.splitext(name)[1].upper().lstrip(".")
                kind = ext

            fg = _SEL_FG if is_sel else col

            name_surf = font_s.render(f"  {icon}  {name}", True, fg)
            kind_surf = font_h.render(kind, True, _DIM if not is_sel else _SEL_FG)

            screen.blit(name_surf, (10, row_y + 5))
            screen.blit(kind_surf, (SCREEN_W - kind_surf.get_width() - 20, row_y + 8))

            # Row divider
            if not is_sel:
                pygame.draw.line(screen, (25, 30, 55),
                                 (0, row_y + ROW_H - 1),
                                 (SCREEN_W, row_y + ROW_H - 1), 1)

        # Scrollbar
        if len(entries) > VISIBLE:
            sb_h     = LIST_BOT - LIST_TOP
            thumb_h  = max(20, int(sb_h * VISIBLE / len(entries)))
            thumb_y  = LIST_TOP + int(sb_h * scroll / max(1, len(entries) - VISIBLE))
            pygame.draw.rect(screen, _BORDER,
                             (SCREEN_W - 8, LIST_TOP, 8, sb_h))
            pygame.draw.rect(screen, _HEADER,
                             (SCREEN_W - 8, thumb_y, 8, thumb_h), border_radius=4)

        pygame.display.flip()
        clock.tick(60)
