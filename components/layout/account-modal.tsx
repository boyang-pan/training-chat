"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Monitor, Sun, Moon } from "lucide-react";

// ---- Types ----

interface SyncJob {
  phase: number;
  status: "running" | "completed" | "failed" | "rate_limited";
  total: number | null;
  synced: number;
  error: string | null;
  started_at: string;
  updated_at: string;
}

interface SyncData {
  phase1: SyncJob | null;
  phase2: SyncJob | null;
  lastActivitySyncedAt: string | null;
}

// ---- Sync helpers ----

function etaLabel(job: SyncJob): string | null {
  if (job.status !== "running" || !job.total) return null;
  const remaining = job.total - job.synced;
  const mins = Math.ceil((remaining / 100) * 15);
  return mins > 60 ? `~${Math.ceil(mins / 60)}h left` : `~${mins}m left`;
}

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function syncStatusCallout(data: SyncData): { text: string; variant: "info" | "success" | "error" } | null {
  const anyFailed = data.phase1?.status === "failed" || data.phase2?.status === "failed";
  const allDone = data.phase1?.status === "completed" && data.phase2?.status === "completed";
  const p1Running = data.phase1?.status === "running";
  const p1Done = data.phase1?.status === "completed";
  const p2 = data.phase2;
  const p2RateLimited = p2?.status === "rate_limited";
  const p2ActivelyRunning = p2?.status === "running" && !isStale(p2);
  const p2Stale = p2 ? isStale(p2) : false;

  if (anyFailed) return { text: "Something went wrong during sync. Try reconnecting your Strava account.", variant: "error" };
  if (allDone) return { text: "All synced. New activities appear automatically within a few minutes of recording.", variant: "success" };
  if (p1Running) return { text: "Importing your activity history — basic queries will be available once this completes.", variant: "info" };
  if (p1Done && p2RateLimited) return { text: "Strava's daily API limit has been reached — enrichment will resume automatically tomorrow.", variant: "error" };
  if (p1Done && p2Stale) return { text: "Enrichment paused — resuming automatically, or click \"Resume sync\" to process a batch now.", variant: "error" };
  if (p1Done && p2ActivelyRunning) return { text: "Basic data is ready — try asking about your runs or weekly mileage. Calories, power, and segments are on their way.", variant: "info" };
  if (p1Done && !p2) return { text: "Activity summaries imported. Enrichment starting shortly…", variant: "info" };
  return null;
}

const STALE_THRESHOLD_MS = 20 * 60 * 1000;

function isStale(job: SyncJob): boolean {
  return (job.status === "running" || job.status === "rate_limited") && Date.now() - new Date(job.updated_at).getTime() > STALE_THRESHOLD_MS;
}

function SyncPhaseDetail({
  title, includes, job, waiting, rateLimitTip,
}: {
  title: string;
  includes: string;
  job: SyncJob | null;
  waiting?: boolean;
  rateLimitTip?: string;
}) {
  if (!job && waiting) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Waiting...</p>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{includes}</p>
      </div>
    );
  }
  if (!job) return null;

  const { status, synced, total } = job;
  const stale = isStale(job);
  const pct = total && total > 0 ? Math.round((synced / total) * 100) : null;
  const eta = !stale ? etaLabel(job) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
        {status === "completed" && <span className="text-xs text-green-500">✓ {synced.toLocaleString()} synced</span>}
        {status === "failed" && <span className="text-xs text-red-500">Failed</span>}
        {status === "rate_limited" && (
          <span className="text-xs text-amber-500 dark:text-amber-400">
            {total ? `${synced.toLocaleString()} / ${total.toLocaleString()}` : `${synced.toLocaleString()}…`}
            <span className="ml-1.5">Rate limited</span>
          </span>
        )}
        {status === "running" && stale && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {total ? `${synced.toLocaleString()} / ${total.toLocaleString()}` : `${synced.toLocaleString()}…`}
            <span className="ml-1.5 text-amber-500 dark:text-amber-400">Stopped</span>
          </span>
        )}
        {status === "running" && !stale && (
          rateLimitTip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 cursor-default underline decoration-dotted underline-offset-2">
                  {total ? `${synced.toLocaleString()} / ${total.toLocaleString()}` : `${synced.toLocaleString()}…`}
                  {eta && <span className="ml-1 text-zinc-400 dark:text-zinc-600">{eta}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[220px] text-xs">{rateLimitTip}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {total ? `${synced.toLocaleString()} / ${total.toLocaleString()}` : `${synced.toLocaleString()}…`}
              {eta && <span className="ml-1 text-zinc-400 dark:text-zinc-600">{eta}</span>}
            </span>
          )
        )}
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{includes}</p>
      {(status === "running" || status === "rate_limited") && (
        <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              status === "rate_limited" ? "bg-amber-400 dark:bg-amber-500" :
              stale ? "bg-zinc-300 dark:bg-zinc-600" : "bg-orange-500"
            )}
            style={{ width: pct !== null ? `${pct}%` : "5%" }}
          />
        </div>
      )}
    </div>
  );
}

// ---- Layout helpers ----

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-6">{children}</h2>;
}

function SettingRow({
  label,
  description,
  children,
  fullWidth = false,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  if (fullWidth) {
    return (
      <div className="py-4 border-b border-zinc-100 dark:border-zinc-800/80">
        <div className="mb-3">
          <p className="text-sm text-zinc-800 dark:text-zinc-200">{label}</p>
          {description && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{description}</p>}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-8 py-4 border-b border-zinc-100 dark:border-zinc-800/80">
      <div className="min-w-0">
        <p className="text-sm text-zinc-800 dark:text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---- Sections ----

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <SectionHeading>General</SectionHeading>
      <SettingRow label="Appearance" description="Choose your preferred colour scheme.">
        <div className="flex gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {([
            { value: "system", icon: Monitor },
            { value: "light", icon: Sun },
            { value: "dark", icon: Moon },
          ] as const).map(({ value, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                theme === value
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
              title={value.charAt(0).toUpperCase() + value.slice(1)}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

function ProfileSection({ userEmail }: { userEmail: string }) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [trainingContext, setTrainingContext] = useState("");
  const [contextLoading, setContextLoading] = useState(false);
  const [contextMsg, setContextMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata;
      setFirstName(meta?.first_name ?? "");
      setLastName(meta?.last_name ?? "");
      setTrainingContext(meta?.training_context ?? "");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameLoading(true);
    setNameMsg(null);
    const first = firstName.trim();
    const last = lastName.trim();
    const { error } = await supabase.auth.updateUser({ data: { first_name: first, last_name: last } });
    if (!error) {
      const fullName = [first, last].filter(Boolean).join(" ") || null;
      window.dispatchEvent(new CustomEvent("user:name-updated", { detail: { name: fullName } }));
    }
    setNameMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Saved." });
    setNameLoading(false);
  }

  async function handleSaveContext(e: React.FormEvent) {
    e.preventDefault();
    setContextLoading(true);
    setContextMsg(null);
    const { error } = await supabase.auth.updateUser({ data: { training_context: trainingContext.trim() } });
    setContextMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Saved." });
    setContextLoading(false);
  }

  return (
    <div>
      <SectionHeading>Profile</SectionHeading>

      <form onSubmit={handleSaveName}>
        <SettingRow label="First name">
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First"
            className="w-56"
          />
        </SettingRow>
        <SettingRow label="Last name">
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last"
            className="w-56"
          />
        </SettingRow>
        <SettingRow label="Email">
          <Input value={userEmail} disabled className="w-56 opacity-60" />
        </SettingRow>
        <div className="flex items-center gap-3 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" disabled={nameLoading}>{nameLoading ? "Saving…" : "Save"}</Button>
          {nameMsg && <p className={`text-xs ${nameMsg.ok ? "text-green-600" : "text-red-500"}`}>{nameMsg.text}</p>}
        </div>
      </form>

      <form onSubmit={handleSaveContext} className="mt-2">
        <SettingRow
          label="About your training"
          description="Tell the agent about your situation — or leave blank if you prefer."
          fullWidth
        >
          <textarea
            value={trainingContext}
            onChange={(e) => setTrainingContext(e.target.value.slice(0, 1000))}
            placeholder="Optional. e.g. 'Training for a half marathon in September, building base at 50km/week' or 'No specific goal — just staying fit and tracking progress.'"
            rows={4}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 resize-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <Button type="submit" size="sm" disabled={contextLoading}>{contextLoading ? "Saving…" : "Save"}</Button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{trainingContext.length}/1000</span>
            {contextMsg && <p className={`text-xs ${contextMsg.ok ? "text-green-600" : "text-red-500"}`}>{contextMsg.text}</p>}
          </div>
        </SettingRow>
      </form>
    </div>
  );
}

function DataSection() {
  const [data, setData] = useState<SyncData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = () => {
    fetch("/api/sync-status")
      .then((r) => r.json())
      .then((d: SyncData) => { setData(d); setLoading(false); })
      .catch(() => { setLoading(false); });
  };

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (!data) return;
    const p2 = data.phase2;
    const activelyRunning =
      data.phase1?.status === "running" ||
      (p2?.status === "running" && !isStale(p2)) ||
      p2?.status === "rate_limited";
    if (!activelyRunning) return;
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [data]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/strava/sync/manual", { method: "POST" });
      const d = await res.json() as { newActivities?: number; error?: string };
      if (!res.ok || d.error) toast.error("Sync failed. Please try again.");
      else if (d.newActivities === 0) toast.success("Already up to date");
      else toast.success(`Synced — ${d.newActivities} new activit${d.newActivities === 1 ? "y" : "ies"} imported`);
    } catch {
      toast.error("Sync failed. Please try again.");
    }
    await fetchStatus();
    setSyncing(false);
  }

  const lastSynced = data?.lastActivitySyncedAt ?? data?.phase2?.updated_at ?? data?.phase1?.updated_at;

  if (loading) {
    return (
      <div>
        <SectionHeading>Data</SectionHeading>
        <div className="space-y-5 animate-pulse">
          <div className="h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <div className="space-y-2">
            <div className="h-3.5 w-2/5 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-2.5 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          </div>
          <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
          <div className="space-y-2">
            <div className="h-3.5 w-2/5 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-2.5 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
          </div>
          <div className="h-9 w-full rounded-md bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Data</SectionHeading>
      <div className="space-y-5">
        {data && (() => {
          const callout = syncStatusCallout(data);
          if (!callout) return null;
          const colors = {
            info: "bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400",
            success: "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400",
            error: "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400",
          };
          return <p className={cn("text-xs px-3 py-2.5 rounded-lg", colors[callout.variant])}>{callout.text}</p>;
        })()}

        <SyncPhaseDetail
          title="Phase 1 — Activity summaries"
          includes="Name, date, distance, time, elevation, heart rate, pace, power"
          job={data?.phase1 ?? null}
        />

        <Separator />

        <SyncPhaseDetail
          title="Phase 2 — Enrichment"
          includes="Calories, max power, description, segment times, PR rank, power and HR per segment"
          job={data?.phase2 ?? null}
          waiting={!!data?.phase1}
          rateLimitTip="Strava limits API requests to 100 per 15 minutes and 1,000 per day. Phase 2 fetches one request per activity, so 1,000 activities takes ~2.5 hours. Segment efforts are extracted from the same requests at no extra cost."
        />

        {data?.phase1?.status === "completed" && (() => {
          const p2 = data.phase2;
          const activelyRunning = p2?.status === "running" && !isStale(p2);
          const needsResume = p2?.status === "failed" || p2?.status === "rate_limited" || (p2 ? isStale(p2) : false);
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={syncing || activelyRunning}
              className="w-full"
            >
              {syncing ? "Syncing…" : needsResume ? "Resume sync" : "Sync new activities"}
            </Button>
          );
        })()}

        {lastSynced && (
          <>
            <Separator />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Last updated: {relativeTime(lastSynced)}</p>
          </>
        )}

        {!data?.phase1 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">No sync data yet. Connect your Strava account to get started.</p>
        )}
      </div>
    </div>
  );
}

function AccountSection({ onLogout, onClose }: { onLogout: () => void; onClose: () => void }) {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setPwMsg({ ok: false, text: "Passwords do not match." }); return; }
    if (newPassword.length < 6) { setPwMsg({ ok: false, text: "Password must be at least 6 characters." }); return; }
    setPwLoading(true);
    setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) { setNewPassword(""); setConfirmPassword(""); }
    setPwMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Password updated." });
    setPwLoading(false);
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    setDeleteLoading(true);
    await supabase.auth.signOut();
    await fetch("/api/account", { method: "DELETE" });
    router.push("/login");
    onClose();
  }

  return (
    <div>
      <SectionHeading>Account</SectionHeading>

      <form onSubmit={handleChangePassword}>
        <SettingRow label="New password">
          <Input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="w-56"
          />
        </SettingRow>
        <SettingRow label="Confirm password">
          <Input
            type="password"
            placeholder="Confirm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="w-56"
          />
        </SettingRow>
        <div className="flex items-center gap-3 py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" variant="outline" disabled={pwLoading}>{pwLoading ? "Updating…" : "Update password"}</Button>
          {pwMsg && <p className={`text-xs ${pwMsg.ok ? "text-green-600" : "text-red-500"}`}>{pwMsg.text}</p>}
        </div>
      </form>

      <SettingRow label="Sign out" description="Sign out of your account on this device.">
        <Button variant="outline" size="sm" onClick={onLogout}>Sign out</Button>
      </SettingRow>

      <div className="pt-6">
        <p className="text-sm font-medium text-red-500 dark:text-red-400 mb-3">Danger zone</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
          To delete your account, type <strong>DELETE</strong> below. This is permanent and cannot be undone.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder='Type "DELETE" to confirm'
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="max-w-56"
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteConfirm !== "DELETE" || deleteLoading}
            onClick={handleDeleteAccount}
          >
            {deleteLoading ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal shell ----

type Section = "general" | "profile" | "data" | "account";

const NAV: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "profile", label: "Profile" },
  { id: "data", label: "Data" },
  { id: "account", label: "Account" },
];

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  onLogout: () => void;
  defaultTab?: "sync" | "settings";
}

export function AccountModal({ open, onClose, userEmail, onLogout, defaultTab = "sync" }: AccountModalProps) {
  const [section, setSection] = useState<Section>(defaultTab === "sync" ? "data" : "general");

  useEffect(() => {
    if (open) setSection(defaultTab === "sync" ? "data" : "general");
  }, [open, defaultTab]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 dark:bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex bg-white dark:bg-zinc-950 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>

          {/* Left sidebar */}
          <div className="w-52 shrink-0 border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 flex flex-col py-6 px-3">
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 px-3 mb-5">Settings</p>
            <nav className="space-y-0.5">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors",
                    section === item.id
                      ? "bg-zinc-200 dark:bg-zinc-700/70 text-zinc-900 dark:text-zinc-100 font-medium"
                      : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto relative">
            <button
              onClick={onClose}
              className="absolute top-5 right-5 p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors z-10"
              aria-label="Close settings"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
              </svg>
            </button>
            <div className="max-w-xl mx-auto px-10 py-8">
              {section === "general" && <GeneralSection />}
              {section === "profile" && <ProfileSection userEmail={userEmail} />}
              {section === "data" && <DataSection />}
              {section === "account" && <AccountSection onLogout={onLogout} onClose={onClose} />}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
