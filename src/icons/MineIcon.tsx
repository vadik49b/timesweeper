interface Props {
  size?: number
}

export default function MineIcon({ size = 16 }: Props) {
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
