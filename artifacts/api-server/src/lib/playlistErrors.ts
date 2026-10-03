// Never return or log raw downloader stderr: it can include local paths or signed URLs.
// Match known failure categories and expose only fixed, actionable messages.
export function downloaderFailure(stderr: string) {
  const failures = [
    {
      reason: "DEPENDENCIES_MISSING",
      pattern: /Missing required dependencies|No module named ['"]yt_dlp|ffmpeg.*not found/i,
      message: "Downloader dependencies are missing on the server. Use the Stage and Boss audio file selectors for now.",
    },
    {
      reason: "TRACK_COUNT_LIMIT",
      pattern: /1[–-]20 tracks|exceeds 20 tracks/i,
      message: "The playlist is empty or exceeds 20 tracks. Use a playlist with 1–20 tracks.",
    },
    {
      reason: "TRACK_SIZE_LIMIT",
      pattern: /24 MB|file size limit exceeded/i,
      message: "A track exceeds the 24 MB limit. Use shorter tracks.",
    },
    {
      reason: "TRACK_DURATION_LIMIT",
      pattern: /12 minute limit/i,
      message: "A track exceeds the 12-minute limit. Remove that track and try again.",
    },
    {
      reason: "SOURCE_ACCESS_BLOCKED",
      pattern: /confirm.*not a bot|sign in|HTTP Error (403|429)|forbidden|too many requests/i,
      message: "YouTube is refusing downloads from this server right now. A public playlist can still be blocked. Try again later, or use the Stage and Boss audio file selectors.",
    },
    {
      reason: "CONVERSION_FAILED",
      pattern: /ffmpeg|ffprobe|postprocessing|conversion failed/i,
      message: "A track could not be converted to MP3 on the server. Try again, or use the Stage and Boss audio file selectors.",
    },
    {
      reason: "SOURCE_CONNECTION_FAILED",
      pattern: /timed out|timeout|unable to download|connection.*(refused|reset)|HTTP Error 5\d\d|name resolution/i,
      message: "The server could not finish downloading a track from YouTube. Try again later, or use the Stage and Boss audio file selectors.",
    },
    {
      reason: "NO_PLAYABLE_TRACKS",
      pattern: /no playable tracks|video unavailable|private video|video is not available|video has been removed/i,
      message: "No playable tracks could be prepared from this server. The videos may be unavailable here even if the playlist itself is public.",
    },
    {
      reason: "OUTPUT_FAILED",
      pattern: /permission denied|no space left|read-only file system/i,
      message: "The server could not save the prepared audio. Try again later, or use the Stage and Boss audio file selectors.",
    },
  ];
  const failure = failures.find(({ pattern }) => pattern.test(stderr));
  return failure
    ? { reason: failure.reason, message: failure.message }
    : {
      reason: "PREPARATION_FAILED",
      message: "The server could not finish preparing the playlist. This does not necessarily mean it is private or too large. Try again, or use the Stage and Boss audio file selectors.",
    };
}