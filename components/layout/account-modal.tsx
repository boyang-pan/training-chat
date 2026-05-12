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
import { Monitor, Sun, Moon, X, ChevronLeft } from "lucide-react";

// ---- Types ----

interface UserProfile {
  date_of_birth?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  preferred_units?: "metric" | "imperial";
  primary_sport?: "running" | "cycling" | "triathlon" | "other" | null;
  experience_level?: "beginner" | "intermediate" | "advanced" | null;
  max_heart_rate?: number | null;
  ftp_watts?: number | null;
  run_threshold_pace_sec?: number | null;
  goal_type?: "race_prep" | "fitness" | "performance" | "other" | null;
  goal_event_name?: string | null;
  goal_event_distance?: string | null;
  goal_event_date?: string | null;
  current_injuries?: string | null;
}

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

function ProfileSection({
  userEmail,
  firstName, setFirstName,
  lastName, setLastName,
}: {
  userEmail: string;
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const [nameLoading, setNameLoading] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameLoading(true);
    const first = firstName.trim();
    const last = lastName.trim();
    const { error } = await supabase.auth.updateUser({ data: { first_name: first, last_name: last } });
    if (!error) {
      const fullName = [first, last].filter(Boolean).join(" ") || null;
      window.dispatchEvent(new CustomEvent("user:name-updated", { detail: { name: fullName } }));
      toast.success("Name saved.");
    } else {
      toast.error(error.message);
    }
    setNameLoading(false);
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
        <div className="py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" disabled={nameLoading}>{nameLoading ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </div>
  );
}

// ---- Native select shared styling ----
const selectClass = "h-9 w-56 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 appearance-none cursor-pointer";

function secToMmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function mmssToSec(str: string): number | null {
  const match = str.match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  const sec = parseInt(match[1]) * 60 + parseInt(match[2]);
  return sec > 60 && sec < 1200 ? sec : null;
}

function AthleticsSection({
  profile,
  trainingContext, setTrainingContext,
  onProfileSaved,
}: {
  profile: UserProfile | null;
  trainingContext: string; setTrainingContext: (v: string) => void;
  onProfileSaved: (p: UserProfile) => void;
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Physical stats
  const [preferredUnits, setPreferredUnits] = useState<"metric" | "imperial">(profile?.preferred_units ?? "metric");
  const [weightDisplay, setWeightDisplay] = useState(
    profile?.weight_kg ? String(profile.weight_kg) : ""
  );
  const [heightDisplay, setHeightDisplay] = useState(
    profile?.height_cm ? String(profile.height_cm) : ""
  );
  const [dateOfBirth, setDateOfBirth] = useState(profile?.date_of_birth ?? "");
  const [physLoading, setPhysLoading] = useState(false);

  // Training profile
  const [primarySport, setPrimarySport] = useState(profile?.primary_sport ?? "");
  const [experienceLevel, setExperienceLevel] = useState(profile?.experience_level ?? "");
  const [maxHR, setMaxHR] = useState(profile?.max_heart_rate ? String(profile.max_heart_rate) : "");
  const [goalType, setGoalType] = useState(profile?.goal_type ?? "");
  const [goalEventName, setGoalEventName] = useState(profile?.goal_event_name ?? "");
  const [goalEventDistance, setGoalEventDistance] = useState(profile?.goal_event_distance ?? "");
  const [goalEventDate, setGoalEventDate] = useState(profile?.goal_event_date ?? "");
  const [trainingLoading, setTrainingLoading] = useState(false);

  // Training thresholds
  const [thresholdPaceDisplay, setThresholdPaceDisplay] = useState(
    profile?.run_threshold_pace_sec ? secToMmss(profile.run_threshold_pace_sec) : ""
  );
  const [ftpWatts, setFtpWatts] = useState(profile?.ftp_watts ? String(profile.ftp_watts) : "");
  const [thresholdsLoading, setThresholdsLoading] = useState(false);

  // Notes
  const [contextLoading, setContextLoading] = useState(false);

  // Sync form state when profile prop changes (e.g. after bootstrap)
  useEffect(() => {
    if (!profile) return;
    setPreferredUnits(profile.preferred_units ?? "metric");
    setWeightDisplay(profile.weight_kg ? String(profile.weight_kg) : "");
    setHeightDisplay(profile.height_cm ? String(profile.height_cm) : "");
    setDateOfBirth(profile.date_of_birth ?? "");
    setPrimarySport(profile.primary_sport ?? "");
    setExperienceLevel(profile.experience_level ?? "");
    setMaxHR(profile.max_heart_rate ? String(profile.max_heart_rate) : "");
    setGoalType(profile.goal_type ?? "");
    setGoalEventName(profile.goal_event_name ?? "");
    setGoalEventDistance(profile.goal_event_distance ?? "");
    setGoalEventDate(profile.goal_event_date ?? "");
    setThresholdPaceDisplay(profile.run_threshold_pace_sec ? secToMmss(profile.run_threshold_pace_sec) : "");
    setFtpWatts(profile.ftp_watts ? String(profile.ftp_watts) : "");
  }, [profile]);

  // Convert displayed weight/height when units toggle
  function handleUnitsChange(next: "metric" | "imperial") {
    const prev = preferredUnits;
    if (prev === next) return;
    if (weightDisplay) {
      const w = parseFloat(weightDisplay);
      if (!isNaN(w)) {
        setWeightDisplay(
          next === "imperial"
            ? String(Math.round(w * 2.2046 * 10) / 10)
            : String(Math.round((w / 2.2046) * 10) / 10)
        );
      }
    }
    if (heightDisplay) {
      const h = parseFloat(heightDisplay);
      if (!isNaN(h)) {
        setHeightDisplay(
          next === "imperial"
            ? String(Math.round(h / 2.54 * 10) / 10)
            : String(Math.round(h * 2.54 * 10) / 10)
        );
      }
    }
    setPreferredUnits(next);
  }

  async function saveProfile(patch: Partial<UserProfile>) {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? "Failed to save");
    }
    const d = await res.json() as { profile: UserProfile };
    onProfileSaved(d.profile);
  }

  async function handleSavePhysical(e: React.FormEvent) {
    e.preventDefault();
    setPhysLoading(true);
    try {
      const weightKg = weightDisplay
        ? preferredUnits === "imperial"
          ? Math.round((parseFloat(weightDisplay) / 2.2046) * 10) / 10
          : parseFloat(weightDisplay)
        : null;
      const heightCm = heightDisplay
        ? preferredUnits === "imperial"
          ? Math.round(parseFloat(heightDisplay) * 2.54 * 10) / 10
          : parseFloat(heightDisplay)
        : null;
      await saveProfile({
        date_of_birth: dateOfBirth || null,
        weight_kg: weightKg,
        height_cm: heightCm,
        preferred_units: preferredUnits,
      });
      toast.success("Physical stats saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    setPhysLoading(false);
  }

  async function handleSaveTraining(e: React.FormEvent) {
    e.preventDefault();
    setTrainingLoading(true);
    try {
      await saveProfile({
        primary_sport: (primarySport as UserProfile["primary_sport"]) || null,
        experience_level: (experienceLevel as UserProfile["experience_level"]) || null,
        max_heart_rate: maxHR ? parseInt(maxHR, 10) : null,
        goal_type: (goalType as UserProfile["goal_type"]) || null,
        goal_event_name: goalEventName || null,
        goal_event_distance: goalEventDistance || null,
        goal_event_date: goalEventDate || null,
      });
      toast.success("Training profile saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    setTrainingLoading(false);
  }

  async function handleSaveThresholds(e: React.FormEvent) {
    e.preventDefault();
    setThresholdsLoading(true);
    try {
      const paceSec = thresholdPaceDisplay ? mmssToSec(thresholdPaceDisplay) : null;
      if (thresholdPaceDisplay && paceSec === null) {
        toast.error("Threshold pace must be in m:ss format (e.g. 5:00).");
        setThresholdsLoading(false);
        return;
      }
      const ftp = ftpWatts ? parseInt(ftpWatts, 10) : null;
      await saveProfile({
        run_threshold_pace_sec: paceSec,
        ftp_watts: ftp,
      });
      toast.success("Training thresholds saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    setThresholdsLoading(false);
  }

  async function handleSaveContext(e: React.FormEvent) {
    e.preventDefault();
    setContextLoading(true);
    const { error } = await supabase.auth.updateUser({ data: { training_context: trainingContext.trim() } });
    if (!error) toast.success("Notes saved.");
    else toast.error(error.message);
    setContextLoading(false);
  }

  const weightLabel = preferredUnits === "imperial" ? "lbs" : "kg";
  const heightLabel = preferredUnits === "imperial" ? "in" : "cm";

  return (
    <div>
      <SectionHeading>Athletics</SectionHeading>

      {/* Group 1: Physical stats */}
      <form onSubmit={handleSavePhysical}>
        <SettingRow label="Preferred units">
          <select
            value={preferredUnits}
            onChange={(e) => handleUnitsChange(e.target.value as "metric" | "imperial")}
            className={selectClass}
          >
            <option value="metric">Metric (km, kg)</option>
            <option value="imperial">Imperial (mi, lbs)</option>
          </select>
        </SettingRow>
        <SettingRow label={`Weight (${weightLabel})`}>
          <Input
            type="number"
            value={weightDisplay}
            onChange={(e) => setWeightDisplay(e.target.value)}
            placeholder={preferredUnits === "imperial" ? "e.g. 160" : "e.g. 72"}
            className="w-56"
            min={0}
            step="0.1"
          />
        </SettingRow>
        <SettingRow label={`Height (${heightLabel})`}>
          <Input
            type="number"
            value={heightDisplay}
            onChange={(e) => setHeightDisplay(e.target.value)}
            placeholder={preferredUnits === "imperial" ? "e.g. 70" : "e.g. 178"}
            className="w-56"
            min={0}
            step="0.1"
          />
        </SettingRow>
        <SettingRow label="Date of birth">
          <Input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-56"
          />
        </SettingRow>
        <div className="py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" disabled={physLoading}>{physLoading ? "Saving…" : "Save"}</Button>
        </div>
      </form>

      {/* Group 2: Training profile */}
      <form onSubmit={handleSaveTraining} className="mt-2">
        <SettingRow label="Primary sport">
          <select
            value={primarySport}
            onChange={(e) => setPrimarySport(e.target.value)}
            className={selectClass}
          >
            <option value="">Select…</option>
            <option value="running">Running</option>
            <option value="cycling">Cycling</option>
            <option value="triathlon">Triathlon</option>
            <option value="other">Other</option>
          </select>
        </SettingRow>
        <SettingRow label="Experience level">
          <select
            value={experienceLevel}
            onChange={(e) => setExperienceLevel(e.target.value)}
            className={selectClass}
          >
            <option value="">Select…</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </SettingRow>
        <SettingRow label="Max heart rate" description="Leave blank to use the 220 − age estimate.">
          <Input
            type="number"
            value={maxHR}
            onChange={(e) => setMaxHR(e.target.value)}
            placeholder="auto"
            className="w-56"
            min={0}
            max={299}
          />
        </SettingRow>
        <SettingRow label="Training goal">
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className={selectClass}
          >
            <option value="">Select…</option>
            <option value="race_prep">Race preparation</option>
            <option value="fitness">General fitness</option>
            <option value="performance">Performance</option>
            <option value="other">Other</option>
          </select>
        </SettingRow>
        {goalType === "race_prep" && (
          <>
            <SettingRow label="Event name">
              <Input
                value={goalEventName}
                onChange={(e) => setGoalEventName(e.target.value)}
                placeholder="e.g. Boston Marathon"
                className="w-56"
              />
            </SettingRow>
            <SettingRow label="Distance" description="Free text, e.g. 42.2km or Half Ironman.">
              <Input
                value={goalEventDistance}
                onChange={(e) => setGoalEventDistance(e.target.value)}
                placeholder="e.g. 42.2km"
                className="w-56"
              />
            </SettingRow>
            <SettingRow label="Race date">
              <Input
                type="date"
                value={goalEventDate}
                onChange={(e) => setGoalEventDate(e.target.value)}
                className="w-56"
              />
            </SettingRow>
          </>
        )}
        <div className="py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" disabled={trainingLoading}>{trainingLoading ? "Saving…" : "Save"}</Button>
        </div>
      </form>

      {/* Group 2.5: Training thresholds */}
      <form onSubmit={handleSaveThresholds} className="mt-2">
        <SettingRow
          label="Run threshold pace"
          description="The pace you can sustain for ~60 min. Auto-estimated from your race history if left blank."
        >
          <Input
            value={thresholdPaceDisplay}
            onChange={(e) => setThresholdPaceDisplay(e.target.value)}
            placeholder="e.g. 5:00"
            className="w-56 font-mono"
          />
        </SettingRow>
        <SettingRow
          label="Cycling FTP (watts)"
          description="Your Functional Threshold Power. Used to compute cycling power zones."
        >
          <Input
            type="number"
            value={ftpWatts}
            onChange={(e) => setFtpWatts(e.target.value)}
            placeholder="e.g. 250"
            className="w-56"
            min={0}
            max={600}
          />
        </SettingRow>
        <div className="py-3 border-b border-zinc-100 dark:border-zinc-800/80">
          <Button type="submit" size="sm" disabled={thresholdsLoading}>
            {thresholdsLoading ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      {/* Group 3: Current injuries */}
      <form onSubmit={async (e) => {
        e.preventDefault();
        setTrainingLoading(true);
        try {
          await saveProfile({ current_injuries: (e.currentTarget.querySelector("textarea") as HTMLTextAreaElement).value || null });
          toast.success("Saved.");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to save");
        }
        setTrainingLoading(false);
      }} className="mt-2">
        <SettingRow
          label="Current injuries / limitations"
          description="The AI will reference this when reviewing your training load or flagging risky patterns."
          fullWidth
        >
          <textarea
            defaultValue={profile?.current_injuries ?? ""}
            placeholder="Optional. e.g. 'Mild left knee tendinopathy — avoiding high mileage spikes'"
            rows={3}
            maxLength={500}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 resize-none"
          />
          <div className="mt-2">
            <Button type="submit" size="sm">Save</Button>
          </div>
        </SettingRow>
      </form>

      {/* Group 4: Additional notes */}
      <form onSubmit={handleSaveContext} className="mt-2">
        <SettingRow
          label="Additional notes"
          description="Anything else the AI should know — context not captured by the fields above."
          fullWidth
        >
          <textarea
            value={trainingContext}
            onChange={(e) => setTrainingContext(e.target.value.slice(0, 1000))}
            placeholder="Optional. e.g. 'I train mostly in the evenings and prefer effort-based descriptions over pace zones.'"
            rows={4}
            className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-500 resize-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <Button type="submit" size="sm" disabled={contextLoading}>{contextLoading ? "Saving…" : "Save"}</Button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{trainingContext.length}/1000</span>
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

type Section = "general" | "profile" | "athletics" | "data" | "account";

const NAV: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "profile", label: "Profile" },
  { id: "athletics", label: "Athletics" },
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

const VALID_SECTIONS: Section[] = ["general", "profile", "athletics", "data", "account"];

export function AccountModal({ open, onClose, userEmail, onLogout, defaultTab = "sync" }: AccountModalProps) {
  const [section, setSection] = useState<Section>(defaultTab === "sync" ? "data" : "general");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [trainingContext, setTrainingContext] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (!open) return;
    setProfileLoaded(false);
    // Restore last visited section (except when opened via sync card — that has intent)
    if (defaultTab === "sync") {
      setSection("data");
    } else {
      const stored = localStorage.getItem("settings-section") as Section | null;
      setSection(stored && VALID_SECTIONS.includes(stored) ? stored : "general");
    }
    // Fetch user metadata and athlete profile in parallel
    Promise.all([
      supabase.auth.getUser(),
      fetch("/api/profile").then((r) => r.json()),
    ]).then(([{ data }, profileRes]) => {
      const meta = data.user?.user_metadata;
      setFirstName(meta?.first_name ?? "");
      setLastName(meta?.last_name ?? "");
      setTrainingContext(meta?.training_context ?? "");
      setProfile((profileRes as { profile: UserProfile | null }).profile ?? null);
      setProfileLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTab]);

  function handleSetSection(s: Section) {
    setSection(s);
    localStorage.setItem("settings-section", s);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 dark:bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex bg-white dark:bg-zinc-950 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>

          {/* Left sidebar */}
          <div className="w-52 shrink-0 border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 flex flex-col py-6 px-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors px-3 mb-4"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to chat
            </button>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 px-3 mb-5">Settings</p>
            <nav className="space-y-0.5">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSetSection(item.id)}
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
              <X className="w-4 h-4" />
            </button>
            <div className="max-w-xl mx-auto px-10 py-8">
              {section === "general" && <GeneralSection />}
              {section === "profile" && (
                <ProfileSection
                  userEmail={userEmail}
                  firstName={firstName} setFirstName={setFirstName}
                  lastName={lastName} setLastName={setLastName}
                />
              )}
              {section === "athletics" && (
                profileLoaded ? (
                  <AthleticsSection
                    profile={profile}
                    trainingContext={trainingContext}
                    setTrainingContext={setTrainingContext}
                    onProfileSaved={setProfile}
                  />
                ) : (
                  <div>
                    <div className="h-7 w-24 rounded bg-zinc-100 dark:bg-zinc-800 mb-6 animate-pulse" />
                    <div className="space-y-5 animate-pulse">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between py-4 border-b border-zinc-100 dark:border-zinc-800/80">
                          <div className="h-3.5 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />
                          <div className="h-9 w-56 rounded-md bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
              {section === "data" && <DataSection />}
              {section === "account" && <AccountSection onLogout={onLogout} onClose={onClose} />}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
