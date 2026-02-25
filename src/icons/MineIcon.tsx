interface Props {
  size?: number
}

export default function MineIcon({ size = 16 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <line x1="8" y1="1" x2="8" y2="4" stroke="black" stroke-width="1.5" />
      <line x1="8" y1="12" x2="8" y2="15" stroke="black" stroke-width="1.5" />
      <line x1="1" y1="8" x2="4" y2="8" stroke="black" stroke-width="1.5" />
      <line x1="12" y1="8" x2="15" y2="8" stroke="black" stroke-width="1.5" />
      <line x1="3" y1="3" x2="5" y2="5" stroke="black" stroke-width="1.2" />
      <line x1="11" y1="3" x2="13" y2="5" stroke="black" stroke-width="1.2" />
      <line x1="3" y1="13" x2="5" y2="11" stroke="black" stroke-width="1.2" />
      <line x1="11" y1="13" x2="13" y2="11" stroke="black" stroke-width="1.2" />
      <circle cx="8" cy="8" r="4" fill="black" />
      <rect x="6" y="6" width="2" height="2" fill="white" />
    </svg>
  )
}
