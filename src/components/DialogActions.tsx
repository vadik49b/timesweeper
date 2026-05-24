import type { JSX } from "solid-js";

interface Props {
	class?: string;
	children: JSX.Element;
}

export default function DialogActions(props: Props) {
	return (
		<div class={["dialog-buttons", props.class].filter(Boolean).join(" ")}>
			{props.children}
		</div>
	);
}
