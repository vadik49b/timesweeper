interface Props {
  size?: number
}

export default function AppIcon({ size = 34 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      {/* Spike lines */}
      <line x1="64" y1="2" x2="64" y2="26" stroke="black" stroke-width="5" stroke-linecap="round" />
      <line
        x1="64"
        y1="102"
        x2="64"
        y2="126"
        stroke="black"
        stroke-width="5"
        stroke-linecap="round"
      />
      <line x1="2" y1="64" x2="26" y2="64" stroke="black" stroke-width="5" stroke-linecap="round" />
      <line
        x1="102"
        y1="64"
        x2="126"
        y2="64"
        stroke="black"
        stroke-width="5"
        stroke-linecap="round"
      />
      <line
        x1="17"
        y1="17"
        x2="34"
        y2="34"
        stroke="black"
        stroke-width="4"
        stroke-linecap="round"
      />
      <line
        x1="94"
        y1="17"
        x2="111"
        y2="34"
        stroke="black"
        stroke-width="4"
        stroke-linecap="round"
      />
      <line
        x1="17"
        y1="111"
        x2="34"
        y2="94"
        stroke="black"
        stroke-width="4"
        stroke-linecap="round"
      />
      <line
        x1="94"
        y1="111"
        x2="111"
        y2="94"
        stroke="black"
        stroke-width="4"
        stroke-linecap="round"
      />

      {/* Bomb body */}
      <circle cx="64" cy="64" r="38" fill="black" />

      {/* Highlight */}
      <ellipse cx="52" cy="48" rx="8" ry="6" fill="white" opacity="0.15" />

      {/* Watch bezel */}
      <rect x="38" y="44" width="52" height="40" rx="3" ry="3" fill="#333" />

      {/* LCD screen */}
      <rect x="42" y="47" width="44" height="34" rx="2" ry="2" fill="#8bac6f" />

      {/* Scanlines */}
      <line x1="42" y1="55" x2="86" y2="55" stroke="#7da162" stroke-width="0.4" opacity="0.4" />
      <line x1="42" y1="63" x2="86" y2="63" stroke="#7da162" stroke-width="0.4" opacity="0.4" />
      <line x1="42" y1="71" x2="86" y2="71" stroke="#7da162" stroke-width="0.4" opacity="0.4" />

      {/* Day row */}
      <text
        x="64"
        y="53"
        text-anchor="middle"
        font-family="'Courier New',monospace"
        font-size="4"
        fill="#4a6338"
        letter-spacing="0.8"
      >
        MO TU WE TH FR SA SU
      </text>

      {/* Date */}
      <text
        x="64"
        y="60"
        text-anchor="middle"
        font-family="'Courier New',monospace"
        font-size="6"
        fill="#3a5228"
        font-weight="bold"
      >
        2-25 WED
      </text>

      {/* Separator */}
      <line x1="45" y1="62" x2="83" y2="62" stroke="#5a7a48" stroke-width="0.4" />

      {/* Time */}
      <text
        x="64"
        y="77"
        text-anchor="middle"
        font-family="'Courier New',monospace"
        font-size="17"
        fill="#2a4018"
        font-weight="bold"
      >
        12:00
      </text>
    </svg>
  )
}
