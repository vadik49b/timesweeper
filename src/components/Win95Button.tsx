import type { JSX } from "solid-js";

interface Props {
	class?: string;
	size?: "normal" | "small";
	variant?: "default" | "toolbar" | "icon" | "cta";
	fullWidth?: boolean;
	disabled?: boolean;
	type?: "button" | "submit" | "reset";
	title?: string;
	ariaLabel?: string;
	onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
	children: JSX.Element;
}

export default function Win95Button(props: Props) {
	const className = () =>
		[
			"win95-button",
			"r",
			`win95-button--${props.size ?? "normal"}`,
			props.variant && props.variant !== "default"
				? `win95-button--variant-${props.variant}`
				: "",
			props.fullWidth ? "win95-button--full-width" : "",
			props.class,
		]
			.filter(Boolean)
			.join(" ");

	return (
		<button
			type={props.type ?? "button"}
			class={className()}
			onClick={props.onClick}
			disabled={props.disabled}
			title={props.title}
			aria-label={props.ariaLabel}
		>
			{props.children}
		</button>
	);
}
