export interface ExtensionPreferences {
  downloadPath: string;
  autoLoadUrlFromClipboard: boolean;
  forceIpv4: boolean;
  preferredCodec: "best" | "av1" | "vp9" | "hevc" | "h264";
  maxQuality: "best" | "2160" | "1440" | "1080" | "720" | "480";
  prefixUploaderInFilename: boolean;
  includeIdInFilename: boolean;
  homebrewPath: string;
}

export type DownloadFormat =
  | { type: "best" }
  | { type: "audio" }
  | { type: "specific"; format: YtDlpFormat; hasAudio: boolean }
  | { type: "headless"; selector: string; label: string };

export interface JobRecord {
  id: string;
  url: string;
  format: DownloadFormat;
  logFile: string;
  title: string;
  uploader?: string;
  thumbnail: string;
  formatLabel: string;
  expectedStreams: 1 | 2;
  filePath?: string;
  completedAt?: number;
  mediaInfo?: MediaInfo;
}

export type CompletedJob = JobRecord & {
  filePath: string;
  completedAt: number;
};

export interface MediaInfo {
  resolution: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrateMbps?: number;
  durationSecs?: number;
}

export interface ProgressInfo {
  percent: number;
  rawPercent: number;
  speed: string;
  streamIndex: number;
}

export interface VideoMetadata {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  live_status: string;
  formats: YtDlpFormat[];
  // Optional enrichment fields from yt-dlp — not present on every extractor.
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  channel_url?: string;
}

export interface YtDlpFormat {
  format_id: string;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  video_ext?: string;
  protocol: string;
  filesize?: number;
  filesize_approx?: number;
  resolution?: string;
  tbr?: number;
  height?: number;
  format_note?: string;
}

export interface TabInfo {
  url: string;
  title: string;
  active: boolean;
  favicon?: string;
}
