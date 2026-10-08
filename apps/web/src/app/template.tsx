/** Re-mounted on every navigation, so the CSS-only entrance animation replays. No client JS. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
