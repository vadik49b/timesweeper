import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useCell, useRow, useStore, useValue } from "tinybase/ui-solid";
import {
	AVAILABILITY_TABLE,
	EVENT_META_CREATED_CELL,
	EVENT_META_NAME_CELL,
	EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
	EVENT_META_TABLE,
} from "../shared/tinybase-schema";
import "./styles/grid.css";
import {
	clearSelectedParticipant,
	DISPLAY_TIMEZONE_VALUE,
	deviceStore,
	pushRecentEvent,
	setDisplayTimezone,
	setSelectedParticipant,
	updateEventSettings,
	useParticipants,
	useSelectedParticipant,
	type EventRoomStatus,
} from "./db";
import Win95Field from "./components/Win95Field";
import Win95Button from "./components/Win95Button";
import Win95Dialog from "./components/Win95Dialog";
import ErrorDialog from "./components/ErrorDialog";
import AvailabilityLegend from "./components/AvailabilityLegend";
import AvailabilityGrid from "./components/AvailabilityGrid";
import OverlapSection from "./components/OverlapSection";
import GridSection from "./components/GridSection";
import DialogActions from "./components/DialogActions";
import SettingsDialog from "./components/SettingsDialog";
import StatusBar from "./components/StatusBar";
import MineIcon from "./icons/MineIcon";
import { getTimezoneOptions } from "./timezone-options";
import {
	type AppEvent,
	buildDisplayModel,
	type DisplayModel,
	findDuplicateName,
	getNameKey,
	type SlotMap,
	type SlotValue,
} from "./event-helpers";

interface Props {
	eventId: string;
	status: () => EventRoomStatus;
}

const EMPTY_DISPLAY: DisplayModel = {
	slots: [],
	days: [],
	times: [],
	slotByDayTime: {},
};
const EMPTY_SLOT_STARTS_UTC_ISO: string[] = [];

export default function Grid(props: Props) {
	const eventName = useCell(
		EVENT_META_TABLE,
		props.eventId,
		EVENT_META_NAME_CELL,
	) as () => string | undefined;
	const eventCreated = useCell(
		EVENT_META_TABLE,
		props.eventId,
		EVENT_META_CREATED_CELL,
	) as () => number | undefined;
	const eventSlotStartsUtcIso = useCell(
		EVENT_META_TABLE,
		props.eventId,
		EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
	) as () => string[] | undefined;
	const participants = useParticipants(props.eventId);
	const event = createMemo<AppEvent | null>(() => {
		const name = eventName();
		const created = eventCreated();
		const slotStartsUtcIso = eventSlotStartsUtcIso();

		if (
			name === undefined ||
			created === undefined ||
			slotStartsUtcIso === undefined
		) {
			return null;
		}

		return {
			id: props.eventId,
			name,
			created,
			slotStartsUtcIso,
			participants: participants(),
		};
	});
	const storedTimezone = useValue(DISPLAY_TIMEZONE_VALUE, deviceStore) as () =>
		| string
		| undefined;
	const displayTimezone = createMemo(
		() => storedTimezone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	const timezoneOptions = createMemo(() =>
		getTimezoneOptions(displayTimezone()),
	);

	const display = createMemo(() => {
		const slotStartsUtcIso =
			eventSlotStartsUtcIso() ?? EMPTY_SLOT_STARTS_UTC_ISO;

		return slotStartsUtcIso.length > 0
			? buildDisplayModel(slotStartsUtcIso, displayTimezone())
			: EMPTY_DISPLAY;
	});
	const displaySlots = () => display().slots;
	const days = () => display().days;
	const times = () => display().times;
	const slotByDayTime = () => display().slotByDayTime;

	const { currentName, storedName: storedParticipantName } =
		useSelectedParticipant(props.eventId, participants);
	const currentParticipant = createMemo(() => {
		const name = currentName();

		if (!name) return null;

		return participants().find((entry) => entry.name === name) ?? null;
	});
	const store = useStore();
	const selectedSlots = useRow(AVAILABILITY_TABLE, () =>
		currentName(),
	) as () => SlotMap;

	type ActiveModal = null | "name-picker" | "settings";
	const [activeModal, setActiveModal] = createSignal<ActiveModal>(
		storedParticipantName() ? null : "name-picker",
	);
	const [settingsEventName, setSettingsEventName] = createSignal("");
	const [settingsParticipantNames, setSettingsParticipantNames] = createSignal<
		string[]
	>([]);
	const [settingsNewParticipantNames, setSettingsNewParticipantNames] =
		createSignal<string[]>([""]);
	const [showAllSettingsParticipants, setShowAllSettingsParticipants] =
		createSignal(false);
	const [dialogError, setDialogError] = createSignal("");
	const [copyStatus, setCopyStatus] = createSignal("");

	let shareInputRef!: HTMLInputElement;
	const pageUrl = `${window.location.origin}/e/${encodeURIComponent(props.eventId)}`;

	function updateDisplayTimezone(timezone: string) {
		setDisplayTimezone(timezone);
	}

	function goToLanding() {
		if (window.location.pathname !== "/") {
			window.history.pushState({}, "", "/");
			window.dispatchEvent(new PopStateEvent("popstate"));
		}
	}

	function cycleCell(slotIndex: number) {
		const s = store();
		const name = currentName();

		if (!s || !name) {
			return;
		}

		const slot = displaySlots()[slotIndex]!;
		const prev =
			(s.getCell(AVAILABILITY_TABLE, name, slot.startUtcIso) as SlotValue) ?? 0;
		const next = ((prev + 1) % 3) as SlotValue;

		if (prev === next) {
			return;
		}

		if (next === 0) {
			s.delCell(AVAILABILITY_TABLE, name, slot.startUtcIso, true);
		} else {
			s.setCell(AVAILABILITY_TABLE, name, slot.startUtcIso, next);
		}

		if (navigator.vibrate) {
			navigator.vibrate(10);
		}
	}

	function paintCells(slotStartUtcIsos: string[], value: SlotValue) {
		const s = store();
		const name = currentName();

		if (!s || !name) {
			return;
		}

		const nextSlotStartsUtcIso = [...new Set(slotStartUtcIsos)].filter(
			(slotStartUtcIso) =>
				((s.getCell(AVAILABILITY_TABLE, name, slotStartUtcIso) as SlotValue) ??
					0) !== value,
		);

		if (nextSlotStartsUtcIso.length === 0) {
			return;
		}

		s.transaction(() => {
			nextSlotStartsUtcIso.forEach((slotStartUtcIso) => {
				if (value === 0) {
					s.delCell(AVAILABILITY_TABLE, name, slotStartUtcIso, true);
				} else {
					s.setCell(AVAILABILITY_TABLE, name, slotStartUtcIso, value);
				}
			});
		});

		if (navigator.vibrate) {
			navigator.vibrate(10);
		}
	}

	function openSettingsModal() {
		const ev = event();

		if (!ev) {
			return;
		}

		setSettingsEventName(ev.name);
		setSettingsParticipantNames(
			ev.participants.slice(1).map((participant) => participant.name),
		);
		setSettingsNewParticipantNames([""]);
		setShowAllSettingsParticipants(false);
		setDialogError("");
		setActiveModal("settings");
	}

	function removeSettingsParticipant(index: number) {
		setSettingsParticipantNames((prev) => prev.filter((_, i) => i !== index));
	}

	function addSettingsParticipantRow() {
		setSettingsNewParticipantNames((prev) => [...prev, ""]);
	}

	function updateSettingsParticipantRow(index: number, value: string) {
		setSettingsNewParticipantNames((prev) =>
			prev.map((entry, entryIndex) => (entryIndex === index ? value : entry)),
		);
	}

	function removeSettingsParticipantRow(index: number) {
		setSettingsNewParticipantNames((prev) => {
			if (prev.length === 1) {
				return [""];
			}

			return prev.filter((_, entryIndex) => entryIndex !== index);
		});
	}

	const visibleSettingsParticipantNames = createMemo(() => {
		const all = settingsParticipantNames();

		if (showAllSettingsParticipants()) {
			return all;
		}

		return all.slice(0, 5);
	});

	async function applyUpdatedEvent(updated: AppEvent, nextSelected: string) {
		await updateEventSettings(updated.id, {
			name: updated.name,
			participants: updated.participants,
		});
		if (nextSelected) {
			setSelectedParticipant(updated.id, nextSelected);
		} else {
			clearSelectedParticipant(updated.id);
		}
	}

	async function saveSettings() {
		const ev = event();

		if (!ev) {
			return;
		}

		const nextEventName = settingsEventName().trim();

		if (!nextEventName) {
			setDialogError("Title is required.");

			return;
		}

		const organizer = participants()[0]?.name ?? "Unknown";
		const organizerParticipant = ev.participants[0];

		if (!organizerParticipant) {
			setDialogError("Organizer is missing.");

			return;
		}

		const nextParticipantNames = [
			...settingsParticipantNames(),
			...settingsNewParticipantNames(),
		]
			.map((name) => name.trim())
			.filter(Boolean);

		const duplicateName = findDuplicateName(nextParticipantNames, [organizer]);

		if (duplicateName) {
			setDialogError(`Duplicate name: "${duplicateName}". Use unique names.`);

			return;
		}

		const existingByKey = new Map(
			ev.participants.map((participant) => [
				getNameKey(participant.name),
				participant,
			]),
		);
		const updatedParticipants = [
			organizerParticipant,
			...nextParticipantNames.map((name) => {
				const existing = existingByKey.get(getNameKey(name));

				if (existing) {
					return { ...existing, name };
				}

				return {
					name,
					slots: {},
				};
			}),
		];

		const updated: AppEvent = {
			...ev,
			name: nextEventName,
			participants: updatedParticipants,
		};
		const selectedKey = getNameKey(currentName());
		const nextSelected =
			updatedParticipants.find(
				(participant) => getNameKey(participant.name) === selectedKey,
			)?.name ?? "";

		await applyUpdatedEvent(updated, nextSelected);
		setActiveModal(nextSelected ? null : "name-picker");
	}

	async function copyLink(url: string) {
		let copied = false;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
		} catch {
			shareInputRef.focus();
			shareInputRef.select();

			if (document.execCommand) {
				copied = document.execCommand("copy");
			}
		}

		if (copied) {
			setCopyStatus("Copied to clipboard!");
		} else {
			setCopyStatus("Select and press Command+C");
		}
	}

	const introContext = createMemo(() => {
		const ev = event();

		if (!ev) {
			return "Share this link with anyone who needs to respond.";
		}

		const organizer = ev.participants[0]?.name ?? "Unknown";
		const current = currentName();

		if (current && getNameKey(current) === getNameKey(organizer)) {
			return `You set up "${ev.name}".`;
		}

		return `${organizer} set up "${ev.name}".`;
	});

	function selectParticipant(name: string) {
		const ev = event();

		if (!ev) {
			return;
		}

		const exists = ev.participants.some(
			(participant) => participant.name === name,
		);

		if (!exists) {
			return;
		}

		setSelectedParticipant(ev.id, name);
		setActiveModal(null);
	}

	async function addParticipantFromPicker(
		submitEvent: SubmitEvent & { currentTarget: HTMLFormElement },
	) {
		submitEvent.preventDefault();

		const formData = new FormData(submitEvent.currentTarget);
		const trimmed = String(formData.get("newParticipantName") ?? "").trim();

		if (!trimmed) {
			setDialogError("Enter your name.");

			return;
		}

		const ev = event();

		if (!ev) {
			return;
		}

		const existing = ev.participants.find(
			(participant) => getNameKey(participant.name) === getNameKey(trimmed),
		);

		if (existing) {
			setDialogError(
				`"${existing.name}" is already on the participant list. Choose a different name, or select "${existing.name}" from the list if that is you.`,
			);

			return;
		}

		const updated: AppEvent = {
			...ev,
			participants: [...ev.participants, { name: trimmed, slots: {} }],
		};
		await applyUpdatedEvent(updated, trimmed);
		setActiveModal(null);
	}

	const useParticipantSelect = createMemo(() => participants().length > 5);
	const participantPickerOptions = createMemo(() => {
		const list = participants();

		if (list.length === 0) {
			return [];
		}

		return [
			{ value: "", label: "Select your name..." },
			...list.map((participant) => ({
				value: participant.name,
				label: participant.name,
			})),
		];
	});

	function onParticipantPickerChange(name: string) {
		if (!name) {
			return;
		}

		selectParticipant(name);
	}

	// Push to recents whenever the canonical name/created cells change
	createEffect(() => {
		const name = eventName();
		const created = eventCreated();

		if (name === undefined || created === undefined) {
			return;
		}

		pushRecentEvent({ id: props.eventId, name, created });
	});

	// Clear stale selection if the participant is removed and reopen name-picker
	createEffect(() => {
		if (props.status() !== "ready") return;
		if (participants().length === 0) return;

		const stored = storedParticipantName() as string | undefined;

		if (stored && !participants().some((p) => p.name === stored)) {
			clearSelectedParticipant(props.eventId);
			setActiveModal("name-picker");
		}
	});

	const canCloseNamePicker = createMemo(() => {
		if (!event()) {
			return true;
		}

		return !!currentName();
	});

	return (
		<div class="grid-view">
				<Show when={props.status() === "ready"} fallback={null}>
					<div class="grid-view__shell">
						<StatusBar
							class="grid-view__connection-bar"
							ready={props.status() === "ready"}
						/>
						<div class="grid-view__hero row row--between row--center">
							<a
								href="/"
								class="grid-view__brand"
								aria-label="Go to TimeSweeper home"
							>
								<MineIcon size={18} /> TimeSweeper
							</a>
							<div class="grid-view__hero-actions row row--center">
								<label class="grid-view__hero-timezone" for="display-timezone">
									View in:
								</label>
								<Win95Field
									kind="select"
									id="display-timezone"
									name="displayTimezone"
									size="small"
									value={displayTimezone()}
									options={timezoneOptions()}
									wrapperClass="grid-view__timezone-field"
									onChange={updateDisplayTimezone}
								/>
							</div>
						</div>

						<div class="grid-view__content">
							<section class="grid-view__steps-panel r">
								<div class="grid-view__panels">
									<div class="grid-view__panel-frame">
										<div class="grid-view__title-row">
											<h2 class="grid-view__pane-title grid-view__pane-title--event">
												{eventName()}
											</h2>
											<Win95Button
												size="small"
												variant="toolbar"
												class="grid-view__title-settings"
												onClick={openSettingsModal}
											>
												Settings
											</Win95Button>
										</div>
										<p class="grid-view__intro-text">
											Hi{" "}
											<button
												type="button"
												class="grid-controls__name-link"
												onClick={() => setActiveModal("name-picker")}
												aria-label="Switch name"
											>
												<span class="grid-controls__name">
													{currentName() || "there"}
												</span>
											</button>
											! {introContext()} Share this page with anyone who needs
											to respond. Fill your availability. The app will show the
											strongest overlaps.
										</p>
										<GridSection
											number={1}
											title="Share the link with everyone"
										>
											<label for="share-link" class="share-panel__label">
												Link:
											</label>
											<div class="share-panel__link-row row">
												<Win95Field
													kind="input"
													id="share-link"
													name="shareLink"
													type="url"
													size="small"
													value={pageUrl}
													readOnly
													wrapperClass="dialog__field share-panel__field"
													inputRef={(el) => {
														shareInputRef = el;
													}}
													onClick={() => shareInputRef.select()}
												/>
												<Win95Button
													size="small"
													variant="toolbar"
													class="share-panel__copy-btn"
													onClick={() => copyLink(pageUrl)}
												>
													Copy
												</Win95Button>
												<div class="copy-status" aria-live="polite">
													{copyStatus()}
												</div>
											</div>
										</GridSection>

										<GridSection number={2} title="Your availability">
											<p class="grid-view__suggestions-helper grid-view__availability-helper">
												<span>
													Click or drag squares to mark your availability:
												</span>
												<AvailabilityLegend withLabels />
											</p>
											<div class="availability-grid-wrap">
												<AvailabilityGrid
													days={days()}
													times={times()}
													slotByDayTime={slotByDayTime()}
													selectedSlots={selectedSlots()}
													onCycle={cycleCell}
													onPaint={paintCells}
												/>
											</div>
										</GridSection>

										<OverlapSection
											participants={participants()}
											currentName={currentName()}
											currentParticipant={currentParticipant()}
											displaySlots={displaySlots()}
										/>
									</div>
								</div>
							</section>
						</div>
						{/* /grid-view__content */}
					</div>
					{/* /grid-view__shell */}

					<Show when={activeModal() === "name-picker"}>
						<Win95Dialog
							title="Choose your name"
							class="dialog--name-picker"
							onClose={
								canCloseNamePicker()
									? () => (event() ? setActiveModal(null) : goToLanding())
									: undefined
							}
							showCloseButton={canCloseNamePicker()}
						>
							<p class="participant-picker__lead">
								{participants()[0]?.name ?? "Unknown"} set up "
								{eventName() ?? "this schedule"}" and wants to know when you're
								available.
							</p>
							<div class="participant-picker__existing">
								<p class="participant-picker__label">Continue as:</p>
								<Show
									when={useParticipantSelect()}
									fallback={
										<div class="participant-picker__list">
											<For each={participants()}>
												{(participant) => (
													<Win95Button
														size="small"
														class={`dialog-btn participant-picker__item${
															currentName() === participant.name
																? " participant-picker__item--selected"
																: ""
														}`}
														onClick={() => {
															selectParticipant(participant.name);
														}}
													>
														{participant.name}
													</Win95Button>
												)}
											</For>
										</div>
									}
								>
									<Win95Field
										kind="select"
										id="participant-picker-select"
										name="participantPicker"
										size="small"
										value={currentName() || ""}
										options={participantPickerOptions()}
										wrapperClass="dialog__field participant-picker__select-field"
										onChange={onParticipantPickerChange}
									/>
								</Show>
							</div>
							<div class="participant-picker__new">
								<label
									class="participant-picker__label"
									for="new-participant-name"
								>
									New here?
								</label>
								<form
									onSubmit={
										addParticipantFromPicker as JSX.EventHandler<
											HTMLFormElement,
											SubmitEvent
										>
									}
								>
									<Win95Field
										kind="input"
										id="new-participant-name"
										name="newParticipantName"
										wrapperClass="dialog__field"
									/>
									<DialogActions class="participant-picker__actions">
										<Win95Button class="dialog-btn" type="submit">
											Join as new participant
										</Win95Button>
									</DialogActions>
								</form>
							</div>
						</Win95Dialog>
					</Show>

					<Show when={activeModal() === "settings"}>
						<SettingsDialog
							eventName={settingsEventName()}
							organizerName={participants()[0]?.name ?? "Unknown"}
							participantNames={settingsParticipantNames()}
							visibleParticipantNames={visibleSettingsParticipantNames()}
							newParticipantNames={settingsNewParticipantNames()}
							showAllParticipants={showAllSettingsParticipants()}
							onEventNameInput={setSettingsEventName}
							onRemoveParticipant={removeSettingsParticipant}
							onAddParticipantRow={addSettingsParticipantRow}
							onUpdateParticipantRow={updateSettingsParticipantRow}
							onRemoveParticipantRow={removeSettingsParticipantRow}
							onToggleAllParticipants={() =>
								setShowAllSettingsParticipants(!showAllSettingsParticipants())
							}
							onSave={saveSettings}
							onCancel={() => setActiveModal(null)}
						/>
					</Show>

					<Show when={!!dialogError()}>
						<ErrorDialog
							message={dialogError()}
							onClose={() => setDialogError("")}
						/>
					</Show>
				</Show>
				<Show
					when={
						props.status() === "not-found" || props.status() === "network-error"
					}
				>
					<ErrorDialog
						title={
							props.status() === "not-found"
								? "Event Not Found"
								: "Could Not Open Schedule"
						}
						message={
							props.status() === "not-found"
								? "We could not find that schedule. The link may be incomplete, or the event may no longer exist."
								: "Check your connection and try opening the link again."
						}
						onClose={goToLanding}
					/>
				</Show>
		</div>
	);
}
