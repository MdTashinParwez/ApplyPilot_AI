import Icon, { type IconName } from "./Icon.js";

type WorkspacePage = "applications" | "discover" | "saved" | "profile";

const links: { id: WorkspacePage; label: string; icon: IconName }[] = [
  { id: "applications", label: "Applications", icon: "grid" },
  { id: "discover", label: "Discover jobs", icon: "search" },
  { id: "saved", label: "Saved jobs", icon: "bookmark" },
  { id: "profile", label: "Candidate profile", icon: "briefcase" }
];

const navItem = "flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-left text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] min-[681px]:w-full min-[681px]:flex-none min-[681px]:justify-start min-[681px]:gap-3 min-[681px]:px-3 min-[681px]:text-[13px]";

export default function WorkspaceNav({ page, applicationCount, onSelect }: {
  page: WorkspacePage;
  applicationCount: number;
  onSelect: (page: WorkspacePage) => void;
}) {
  return <nav className="mt-3 flex flex-row gap-1 overflow-x-auto min-[681px]:mt-0 min-[681px]:flex-col min-[681px]:overflow-visible" aria-label="Workspace">
    {links.map(link => <button key={link.id} className={`${navItem} ${page === link.id ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`} aria-current={page === link.id ? "page" : undefined} onClick={() => onSelect(link.id)}>
      <Icon name={link.icon} className="h-4 w-4 shrink-0" />{link.label}{link.id === "applications" && <span className="ml-auto rounded-full bg-[var(--accent-border)] px-2 py-0.5 text-[11px]">{applicationCount}</span>}
    </button>)}
  </nav>;
}
