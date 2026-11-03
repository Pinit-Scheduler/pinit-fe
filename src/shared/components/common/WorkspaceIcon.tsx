import type { SVGProps } from 'react'
const paths = {
  sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  calendar:
    'M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm2-3v6m10-6v6M4 10h16M8 14h2m4 0h2m-8 3h2',
  task: 'M9 12l2 2 5-6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  map: 'M9 3h6v5H9ZM2 16h6v5H2Zm14 0h6v5h-6ZM12 8v4M5 16v-4h14v4',
  chart: 'M4 3v18h17M8 17v-5m5 5V7m5 10V4',
  plus: 'M12 5v14M5 12h14',
  settings:
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  repeat:
    'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  back: 'm14 5-7 7 7 7',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  pin: 'm8 11 3 3 5-6M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z',
} as const
export type WorkspaceIconName = keyof typeof paths
export default function WorkspaceIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: WorkspaceIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
