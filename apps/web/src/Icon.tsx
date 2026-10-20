import type { ReactNode } from "react";

export type IconName = "grid" | "search" | "bookmark" | "briefcase" | "chart" | "sparkles" | "plus" | "filter" | "chevronDown" | "ellipsis" | "arrowUpRight";

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  bookmark: <path d="M6 3.75h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.75a1 1 0 0 1 1-1Z" />,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18m-11 0v2h4v-2" /></>,
  chart: <><path d="M4 20V4m0 16h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4" /><circle cx="8" cy="7" r="1.5" fill="currentColor" /><circle cx="15" cy="12" r="1.5" fill="currentColor" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  ellipsis: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  arrowUpRight: <><path d="M7 17 17 7M8 7h9v9" /></>
};

export default function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
