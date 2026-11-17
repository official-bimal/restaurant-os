import type { SVGProps } from "react";

/** A small set of line icons (24px grid, 1.8 stroke). Drawn for this app, no icon library. */
const PATHS: Record<string, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  orders: "M7 3h10a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Zm2 5h6M9 12h6",
  kitchen: "M6 14a4 4 0 1 1 1-7.9A4 4 0 0 1 14 5a4 4 0 0 1 3 7M6 14h12v5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-5Z",
  tables: "M4 9h16M6 9v10M18 9v10M5 5h14a1 1 0 0 1 1 1v3H4V6a1 1 0 0 1 1-1Z",
  menu: "M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm0 14a2 2 0 0 1 2-2h11M9 8h5",
  stock: "M3 8l9-5 9 5-9 5-9-5Zm0 4 9 5 9-5M3 16l9 5 9-5",
  campaigns: "M4 13v-2a1 1 0 0 1 1-1h3l8-5v14l-8-5H5a1 1 0 0 1-1-1Zm14-3a3 3 0 0 1 0 4",
  feedback: "M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.8L12 3Z",
  reports: "M5 20V10m5 10V4m5 16v-7m5 7H3",
  bills: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
  customers: "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1m16 0v-1a4 4 0 0 0-3-3.9M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-.2a3 3 0 0 0 0-5.6",
  branches: "M4 20V9l8-5 8 5v11M9 20v-6h6v6",
  staff: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5Z",
  logout: "M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5m5-4 4-4-4-4m4 4H9",
  menuIcon: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 6 6 6-6 6",
  bell: "M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Zm4 4a2 2 0 0 0 4 0",
  check: "m5 12.5 4.5 4.5L19 7.5",
  truck: "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2",
  extras: "M12 5v14M5 12h14M4 4h4v4H4V4Zm12 12h4v4h-4v-4Z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5", ...rest }: { name: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={PATHS[name] ?? PATHS.dashboard} />
    </svg>
  );
}
