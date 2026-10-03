import importlib.util
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "stream2mp3", Path(__file__).parents[1] / "scripts" / "stream2mp3.py")
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


class DownloaderContractTests(unittest.TestCase):
    def run_playlist(self, entries, missing=None):
        calls = []
        class FakeYDL:
            def __init__(self, options):
                self.options = options
                calls.append(options)
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def extract_info(self, url, download=False):
                if not download:
                    return {"entries": entries}
                video_id = url.split("v=")[1]
                if video_id != missing:
                    Path(self.options["outtmpl"].replace("%(ext)s", "mp3")).write_bytes(b"MP3")
                return {"id": video_id}
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict("sys.modules", {"yt_dlp": types.SimpleNamespace(YoutubeDL=FakeYDL)}), \
                patch.object(script, "build_ydl_options", return_value={}):
            script.game_playlist("https://music.youtube.com/playlist?list=PL_Test", Path(directory))
            return json.loads((Path(directory) / "manifest.json").read_text()), calls

    def test_manifest_preserves_order_including_duplicate_titles(self):
        manifest, calls = self.run_playlist([
            {"id": "abcdefghijk", "title": "Same"},
            {"id": "lmnopqrstuv", "title": "Same"},
        ])
        self.assertEqual([track["file"] for track in manifest["tracks"]], ["0001.mp3", "0002.mp3"])
        self.assertEqual(calls[0]["playlistend"], 21)
        self.assertEqual(calls[1]["max_filesize"], 24 * 1024 * 1024)
        with self.assertRaises(ValueError):
            calls[1]["progress_hooks"][0]({"status": "downloading", "downloaded_bytes": 24 * 1024 * 1024 + 1})
        self.assertIsNotNone(calls[1]["match_filter"]({"duration": 721}, incomplete=False))

    def test_unavailable_tracks_are_skipped_without_reordering(self):
        manifest, _ = self.run_playlist([
            None, {"id": "abcdefghijk", "title": "Available"},
            {"id": "lmnopqrstuv", "title": "Private"},
        ], missing="lmnopqrstuv")
        self.assertEqual(manifest["skipped"], 2)
        self.assertEqual(manifest["tracks"][0]["file"], "0002.mp3")

    def test_empty_oversized_and_all_unavailable_fail_explicitly(self):
        for entries in [[], [{"id": "abcdefghijk"}] * 21, [None]]:
            with self.assertRaises(ValueError):
                self.run_playlist(entries)

    def test_url_validation_precedes_extraction(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict("sys.modules", {"yt_dlp": types.SimpleNamespace()}):
            for url in ["https://evil.test/playlist?list=A", "http://music.youtube.com/playlist?list=A"]:
                with self.assertRaises(ValueError):
                    script.game_playlist(url, Path(directory))