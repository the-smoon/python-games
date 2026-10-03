#!/usr/bin/env python3
"""
stream2mp3.py - Extract audio from streaming video links to MP3 format.

Supports:
- YouTube, YouTube Music, Vimeo, Twitch, SoundCloud, TikTok, Twitter/X, Facebook, etc.
- Direct HLS (.m3u8), DASH (.mpd), and direct video/audio URLs.
- ID3 metadata tagging (title, artist, uploader, date) and embedded album art / thumbnail.
- Unlisted and public playlists with automatic skipping of unavailable/private videos.
- Resume capability: skips files that are already downloaded.
- Batch downloading and interactive mode.
"""

import argparse
import os
import shutil
import sys
from pathlib import Path


def check_dependencies():
    """Verify that external tools (ffmpeg) and python libraries (yt-dlp) are installed."""
    missing = []
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg - install via your package manager (e.g., sudo dnf install ffmpeg)")
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        missing.append("yt-dlp - install via 'pip install --user yt-dlp'")

    if missing:
        print("\n❌ Error: Missing required dependencies:", file=sys.stderr)
        for dep in missing:
            print(f"   • {dep}", file=sys.stderr)
        print("\nPlease install the missing dependencies and run the script again.\n", file=sys.stderr)
        sys.exit(1)


def format_bytes(bytes_count: int) -> str:
    """Format byte count into human-readable string (KB, MB, GB)."""
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_count < 1024.0:
            return f"{bytes_count:.2f} {unit}"
        bytes_count /= 1024.0
    return f"{bytes_count:.2f} TB"


def build_ydl_options(output_dir: Path, bitrate: str = "320k", embed_thumbnail: bool = True,
                      embed_metadata: bool = True, download_playlist: bool = True,
                      overwrite: bool = False, stats: dict = None,
                      verbose: bool = False) -> dict:
    """Build configuration dictionary for yt_dlp.YoutubeDL."""
    from yt_dlp.utils import sanitize_filename

    clean_bitrate = bitrate.rstrip("kK") if bitrate.lower().endswith("k") else bitrate

    postprocessors = [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": clean_bitrate,
        }
    ]

    if embed_metadata:
        postprocessors.append({
            "key": "FFmpegMetadata",
            "add_metadata": True,
        })

    if embed_thumbnail:
        postprocessors.append({
            "key": "EmbedThumbnail",
            "already_have_thumbnail": False,
        })

    # Skip files that have already been converted to MP3 unless overwrite is requested
    def filter_existing(info_dict, *, incomplete):
        if overwrite:
            return None
        title = info_dict.get("title")
        if title:
            candidate1 = output_dir / f"{title}.mp3"
            candidate2 = output_dir / f"{sanitize_filename(title)}.mp3"
            if candidate1.exists() or candidate2.exists():
                if stats is not None:
                    stats["already_exists"] += 1
                return f"Already exists: {title}.mp3"
        return None

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(output_dir / "%(title)s.%(ext)s"),
        "postprocessors": postprocessors,
        "noplaylist": not download_playlist,
        "writethumbnail": embed_thumbnail,
        "quiet": not verbose,
        "no_warnings": not verbose,
        # Crucial for playlists: continue downloading even if some videos are unavailable/private
        "ignoreerrors": "only_download",
        "match_filter": filter_existing,
    }

    # Track extracted audio tracks
    def pp_hook(d):
        if d.get("status") == "finished" and d.get("postprocessor") == "ExtractAudio":
            if stats is not None:
                stats["downloaded"] += 1

    ydl_opts["postprocessor_hooks"] = [pp_hook]

    # Detect node / JS runtime to avoid YouTube extraction warnings
    node_path = shutil.which("node") or "/home/linuxbrew/.linuxbrew/bin/node"
    if os.path.exists(node_path):
        ydl_opts["js_runtimes"] = {"node": {}}

    return ydl_opts


def process_url(url: str, output_dir: Path, bitrate: str = "320k",
                embed_thumbnail: bool = True, embed_metadata: bool = True,
                download_playlist: bool = True, overwrite: bool = False,
                verbose: bool = False) -> bool:
    """Download and extract audio from a given URL."""
    import yt_dlp

    stats = {
        "downloaded": 0,
        "already_exists": 0,
    }

    ydl_opts = build_ydl_options(
        output_dir=output_dir,
        bitrate=bitrate,
        embed_thumbnail=embed_thumbnail,
        embed_metadata=embed_metadata,
        download_playlist=download_playlist,
        overwrite=overwrite,
        stats=stats,
        verbose=verbose,
    )

    print(f"\n▶️  Fetching: {url}")

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                print(f"⚠️  No media information found for: {url}")
                return False

            is_playlist = info.get("_type") == "playlist" or "entries" in info
            title = info.get("title", "Audio")

            if is_playlist:
                entries = info.get("entries") or []
                total_in_playlist = len(entries) if entries else (stats["downloaded"] + stats["already_exists"])
                print("\n" + "=" * 50)
                print(f"✨ Playlist Finished: {title}")
                print(f"   • Newly downloaded & converted: {stats['downloaded']}")
                print(f"   • Already downloaded (skipped):  {stats['already_exists']}")
                if total_in_playlist > 0:
                    skipped = max(0, total_in_playlist - (stats["downloaded"] + stats["already_exists"]))
                    if skipped > 0:
                        print(f"   • Unavailable/Hidden videos:    {skipped}")
                print(f"📂 Output directory: {output_dir.resolve()}")
                print("=" * 50 + "\n")
                return True
            else:
                expected_file = output_dir / f"{title}.mp3"
                if expected_file.exists():
                    size = format_bytes(expected_file.stat().st_size)
                    print(f"✅ Saved: {expected_file.name} ({size})")
                    print(f"📂 Location: {expected_file.resolve()}\n")
                elif stats["already_exists"] > 0:
                    print(f"ℹ️  File already exists in {output_dir.resolve()}\n")
                else:
                    print(f"✅ Finished: {title}\n")
                return True

    except yt_dlp.utils.DownloadError as e:
        print(f"❌ Download error: {e}\n", file=sys.stderr)
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}\n", file=sys.stderr)
        return False


def run_interactive(output_dir: Path, bitrate: str, embed_thumbnail: bool,
                    embed_metadata: bool, download_playlist: bool,
                    overwrite: bool, verbose: bool):
    """Prompt user interactively for streaming links."""
    print("=" * 60)
    print("🎵 Stream2MP3 - Interactive Audio Extractor")
    print(f"📁 Saving files to: {output_dir.resolve()}")
    print("Type a URL and press Enter (or 'q' / 'exit' to quit).")
    print("=" * 60)

    while True:
        try:
            url = input("\n🔗 Enter streaming link: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting. Goodbye!")
            break

        if not url:
            continue
        if url.lower() in ("q", "quit", "exit"):
            print("Exiting. Goodbye!")
            break

        process_url(
            url=url,
            output_dir=output_dir,
            bitrate=bitrate,
            embed_thumbnail=embed_thumbnail,
            embed_metadata=embed_metadata,
            download_playlist=download_playlist,
            overwrite=overwrite,
            verbose=verbose,
        )


def parse_arguments():
    parser = argparse.ArgumentParser(
        prog="stream2mp3",
        description="Extract audio in MP3 format from streaming video links (YouTube, YouTube Music, Twitch, Vimeo, HLS, DASH, etc.).",
        epilog="Example: stream2mp3 'https://music.youtube.com/playlist?list=...' -o ~/Music -b 320k"
    )

    parser.add_argument(
        "urls",
        nargs="*",
        help="One or more streaming video or playlist URLs to download."
    )
    parser.add_argument(
        "-o", "--output-dir",
        default=".",
        help="Directory to save the extracted MP3 file(s). (default: current directory)"
    )
    parser.add_argument(
        "-b", "--bitrate",
        default="320k",
        help="Audio bitrate quality (e.g. 128k, 192k, 256k, 320k). (default: 320k)"
    )
    parser.add_argument(
        "-f", "--batch-file",
        help="Path to a text file containing URLs to download (one URL per line)."
    )
    parser.add_argument(
        "--no-thumbnail",
        action="store_true",
        help="Do not embed video thumbnail / cover art into the MP3 file."
    )
    parser.add_argument(
        "--no-metadata",
        action="store_true",
        help="Do not embed metadata tags (title, artist, uploader, date)."
    )

    playlist_group = parser.add_mutually_exclusive_group()
    playlist_group.add_argument(
        "--playlist",
        dest="playlist",
        action="store_true",
        default=True,
        help="Download all videos if URL refers to a playlist (default: enabled)."
    )
    playlist_group.add_argument(
        "--no-playlist",
        dest="playlist",
        action="store_false",
        help="Download only the single video even if URL contains playlist parameters."
    )

    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-download and overwrite files even if they already exist locally."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed yt-dlp and ffmpeg output."
    )

    return parser.parse_args()


def main():
    check_dependencies()
    args = parse_arguments()

    output_dir = Path(args.output_dir).expanduser().resolve()
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"❌ Error creating output directory '{output_dir}': {e}", file=sys.stderr)
        sys.exit(1)

    urls = list(args.urls)

    # Read batch file if specified
    if args.batch_file:
        batch_path = Path(args.batch_file).expanduser().resolve()
        if not batch_path.is_file():
            print(f"❌ Error: Batch file '{batch_path}' not found.", file=sys.stderr)
            sys.exit(1)
        with open(batch_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    urls.append(line)

    if not urls:
        # Interactive mode if no URLs were provided via CLI
        run_interactive(
            output_dir=output_dir,
            bitrate=args.bitrate,
            embed_thumbnail=not args.no_thumbnail,
            embed_metadata=not args.no_metadata,
            download_playlist=args.playlist,
            overwrite=args.overwrite,
            verbose=args.verbose,
        )
    else:
        print(f"🎧 Stream2MP3 starting...")
        print(f"📂 Output directory: {output_dir}")
        print(f"🎵 Audio Quality:    {args.bitrate} MP3\n")
        success_count = 0
        for url in urls:
            if process_url(
                url=url,
                output_dir=output_dir,
                bitrate=args.bitrate,
                embed_thumbnail=not args.no_thumbnail,
                embed_metadata=not args.no_metadata,
                download_playlist=args.playlist,
                overwrite=args.overwrite,
                verbose=args.verbose,
            ):
                success_count += 1
        print(f"🎉 Done! Processed {success_count}/{len(urls)} link(s) successfully.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
        sys.exit(130)
