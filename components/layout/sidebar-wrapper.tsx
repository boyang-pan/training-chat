"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Sidebar } from "@/components/layout/sidebar";
import { AccountModal } from "@/components/layout/account-modal";
import { SearchModal } from "@/components/layout/search-modal";
import type { Conversation } from "@/types";

export function SidebarWrapper() {
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"sync" | "settings">("sync");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      const meta = data.user?.user_metadata;
      const name = [meta?.first_name, meta?.last_name].filter(Boolean).join(" ") || null;
      setUserName(name);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeId = pathname.startsWith("/chat/")
    ? pathname.replace("/chat/", "")
    : null;

  useEffect(() => {
    setIsLoadingConversations(true);
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setConversations(data);
          window.dispatchEvent(new CustomEvent("conversations:updated", { detail: data }));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingConversations(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleRenamed(e: Event) {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    }
    window.addEventListener("conversation:renamed", handleRenamed);
    return () => window.removeEventListener("conversation:renamed", handleRenamed);
  }, []);

  useEffect(() => {
    function handleNameUpdated(e: Event) {
      const { name } = (e as CustomEvent<{ name: string | null }>).detail;
      setUserName(name);
    }
    window.addEventListener("user:name-updated", handleNameUpdated);
    return () => window.removeEventListener("user:name-updated", handleNameUpdated);
  }, []);

  async function handleNew() {
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = await res.json();
    if (data?.id) {
      const newConv = { id: data.id, title: null, created_at: new Date().toISOString() };
      setConversations((prev) => {
        const updated = [newConv, ...prev];
        window.dispatchEvent(new CustomEvent("conversations:updated", { detail: updated }));
        return updated;
      });
      router.push(`/chat/${data.id}`);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleNew();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(id: string) {
    router.push(`/chat/${id}`);
  }

  async function handleDelete(id: string) {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      window.dispatchEvent(new CustomEvent("conversations:updated", { detail: updated }));
      return updated;
    });
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) router.push("/chat");
  }

  async function handleRename(id: string, title: string) {
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, title } : c));
      window.dispatchEvent(new CustomEvent("conversations:updated", { detail: updated }));
      return updated;
    });
    window.dispatchEvent(new CustomEvent("conversation:renamed", { detail: { id, title } }));
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async function handlePin(id: string, pinned: boolean) {
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, pinned } : c));
      window.dispatchEvent(new CustomEvent("conversations:updated", { detail: updated }));
      return updated;
    });
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <Sidebar
        conversations={conversations}
        isLoadingConversations={isLoadingConversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        userEmail={userEmail}
        userName={userName}
        onLogout={handleLogout}
        onOpenModal={(tab) => { setModalTab(tab); setModalOpen(true); }}
        onOpenSearch={() => setIsSearchOpen(true)}
        onPin={handlePin}
      />
      {userEmail && (
        <AccountModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          userEmail={userEmail}
          onLogout={handleLogout}
          defaultTab={modalTab}
        />
      )}
      <SearchModal
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        conversations={conversations}
        onSelect={handleSelect}
      />
    </>
  );
}
