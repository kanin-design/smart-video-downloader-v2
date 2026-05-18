import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import * as path from "path";
import type { JobRecord, MediaInfo, ProgressInfo } from "./types.js";
import { getJobsFile, getLogDir } from "./utils.js";

// ── In-memory state ──────────────────────────────────────────────────────────

let jobs: JobRecord[] = [];
const progress = new Map<string, ProgressInfo>();
const pollHandles = new Map<string, ReturnType<typeof setInterval>>();
const subscribers = new Set<() => void>();

// ── Initialization guard (once per process) ──────────────────────────────────

let initialized = false;
let initPromise: Promise<void> | null = null;

export function ensureInitialized(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  loadJobsSync();
  const { resumeDownloads } = await import("./downloader.js");
  await resumeDownloads();
  initialized = true;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function isPlausibleJob(j: unknown): j is JobRecord {
  if (!j || typeof j !== "object") return false;
  const r = j as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.url === "string" &&
    typeof r.logFile === "string" &&
    typeof r.title === "string"
  );
}

function loadJobsSync(): void {
  try {
    const file = getJobsFile();
    if (!existsSync(file)) return;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(parsed)) {
      jobs = [];
      return;
    }
    jobs = parsed.filter(isPlausibleJob);
  } catch (err) {
    console.error("Failed to load jobs.json — starting empty:", err);
    jobs = [];
  }
}

export function saveJobs(): void {
  try {
    const file = getJobsFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(jobs), "utf-8");
  } catch (err) {
    console.error("Failed to save jobs.json:", err);
  }
}

// ── Subscribers ──────────────────────────────────────────────────────────────

export function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function notify(): void {
  for (const l of subscribers) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function getJobs(): JobRecord[] {
  return jobs;
}

export function getJobById(id: string): JobRecord | undefined {
  return jobs.find((j) => j.id === id);
}

export function getProgress(jobId: string): ProgressInfo | undefined {
  return progress.get(jobId);
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function setJobs(newJobs: JobRecord[]): void {
  jobs = newJobs;
  saveJobs();
  notify();
}

export function addJob(job: JobRecord): void {
  jobs = [job, ...jobs];
  saveJobs();
  notify();
}

export function completeJob(jobId: string, filePath: string): void {
  jobs = jobs.map((j) =>
    j.id === jobId ? { ...j, filePath, completedAt: Date.now() } : j,
  );
  progress.delete(jobId);
  stopPolling(jobId);
  saveJobs();
  notify();
}

export function removeJob(jobId: string): void {
  const job = jobs.find((j) => j.id === jobId);
  if (job?.logFile) {
    try {
      unlinkSync(job.logFile);
    } catch {
      /* ignore */
    }
  }
  jobs = jobs.filter((j) => j.id !== jobId);
  progress.delete(jobId);
  stopPolling(jobId);
  saveJobs();
  notify();
}

export function updateJobMediaInfo(jobId: string, mediaInfo: MediaInfo): void {
  jobs = jobs.map((j) => (j.id === jobId ? { ...j, mediaInfo } : j));
  saveJobs();
  notify();
}

export function updateProgress(jobId: string, info: ProgressInfo): void {
  progress.set(jobId, info);
  notify();
}

// ── Polling ──────────────────────────────────────────────────────────────────

export function startPolling(jobId: string, onTick: () => void): void {
  if (pollHandles.has(jobId)) return;
  const handle = setInterval(onTick, 500);
  pollHandles.set(jobId, handle);
}

export function stopPolling(jobId: string): void {
  const h = pollHandles.get(jobId);
  if (h) {
    clearInterval(h);
    pollHandles.delete(jobId);
  }
}

export function isPolling(jobId: string): boolean {
  return pollHandles.has(jobId);
}

// ── Log dir ───────────────────────────────────────────────────────────────────

export function ensureLogDir(): void {
  mkdirSync(getLogDir(), { recursive: true });
}
