interface Props {
	size?: number;
}

export default function MineIcon({ size = 16 }: Props) {
	return (
		<picture>
			<source srcset="/anti-tank-mine-logo.avif" type="image/avif" />
			<source srcset="/anti-tank-mine-logo.webp" type="image/webp" />
			<img
				src="/anti-tank-mine-logo.png"
				width={size}
				height={size}
				style={{ "object-fit": "contain", display: "block" }}
				alt=""
			/>
		</picture>
	);
}
