/** Simple line icons for the navigation bar (24×24, currentColor). */
const paths: Record<string, string> = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h2m3 0h2m-7 4h2m3 0h2',
  chats: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 5h8m-8 3h5',
  lineup: 'M4 3h16v18H4zM4 12h16M9 3v3a3 3 0 0 0 6 0V3M9 21v-3a3 3 0 0 1 6 0v3',
  squad: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 9v-1a5 5 0 0 1 10 0v1m2-9a3 3 0 1 0 0-6m2 15v-1a5 5 0 0 0-3-4.6',
  matches: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3-9 2 2 4-4',
  training: 'M4 20 14 10m-4-6 3 3m-9 9 3 3M14 4l6 6-3 3-6-6 3-3Z',
  children: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm9 3a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 20v-2a5 5 0 0 1 10 0v2m2 0v-1.5a3.5 3.5 0 0 1 6 0V20',
  announcements: 'M4 10v4h3l6 4V6L7 10H4Zm12-1a3 3 0 0 1 0 6m2-9a7 7 0 0 1 0 12',
  fixtures: 'M5 4h14v16H5zM9 8h6m-6 4h6m-6 4h4',
  matchday: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l3 2M10 2h4',
  stats: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  schedule: 'M3 4h18v16H3zM3 9h18M9 4v16M3 14.5h18',
  season: 'M4 5h16v15H4zM4 10h16M8 3v4m8-4v4M8 14l2 2 4-4',
  pitches: 'M3 6h18v12H3zM12 6v12M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  membership: 'M3 6h18v12H3zM3 10h18M7 15h4',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9v-1a7 7 0 0 1 14 0v1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.more} />
    </svg>
  );
}
