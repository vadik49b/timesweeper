interface Props {
  size?: number
}

export default function AppIcon({ size = 34 }: Props) {
  return (
    <img
      src="/anti-tank-mine-logo.png"
      width={size}
      height={size}
      style={{ 'object-fit': 'contain', display: 'block' }}
      alt=""
    />
  )
}
