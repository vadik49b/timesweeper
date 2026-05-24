import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { createStore } from "tinybase";
import { createMergeableStore } from "tinybase/mergeable-store";
import { createLocalPersister } from "tinybase/persisters/persister-browser";
import {
	createWsSynchronizer,
	type WsSynchronizer,
} from "tinybase/synchronizers/synchronizer-ws-client";
import { useCell, useTable } from "tinybase/ui-solid";
import ReconnectingWebSocket from "reconnecting-websocket";
import type { AppEvent, Participant, SlotMap } from "./event-helpers";
import {
	AVAILABILITY_TABLE,
	EVENT_META_CREATED_CELL,
	EVENT_META_TABLE,
	EVENT_META_NAME_CELL,
	EVENT_META_PARTICIPANT_NAMES_CELL,
	EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from "../shared/tinybase-schema.ts";

// ─── Local store (device-only, non-synced) ───────────────────────────────────

export const RECENT_EVENTS_TABLE = "recentEvents";
export const SELECTED_PARTICIPANTS_TABLE = "selectedParticipants";
export const DISPLAY_TIMEZONE_VALUE = "displayTimezone";

const MAX_RECENT_EVENTS = 5;

export const deviceStore = createStore();
const devicePersister = createLocalPersister(deviceStore, "timesweeper-local");

async function initDeviceStore() {
	try {
		await devicePersister.load();
		await devicePersister.startAutoSave();
	} catch (error) {
		console.error("Failed to initialize device store", error);
	}
}

initDeviceStore();

export function setSelectedParticipant(eventId: string, name: string): void {
	deviceStore.setCell(SELECTED_PARTICIPANTS_TABLE, eventId, "name", name);
}

export function clearSelectedParticipant(eventId: string): void {
	deviceStore.delRow(SELECTED_PARTICIPANTS_TABLE, eventId);
}

export function setDisplayTimezone(timezone: string): void {
	deviceStore.setValue(DISPLAY_TIMEZONE_VALUE, timezone);
}

export function pushRecentEvent(summary: RecentEventSummary): void {
	deviceStore.setRow(RECENT_EVENTS_TABLE, summary.id, {
		name: summary.name,
		created: summary.created,
	});

	const table = deviceStore.getTable(RECENT_EVENTS_TABLE);
	const sorted = Object.keys(table).sort(
		(a, b) => (table[b]!.created as number) - (table[a]!.created as number),
	);

	sorted.slice(MAX_RECENT_EVENTS).forEach((id) => {
		deviceStore.delRow(RECENT_EVENTS_TABLE, id);
	});
}

// ─── Reactive hooks ──────────────────────────────────────────────────────────

export function useParticipants(eventId: string): Accessor<Participant[]> {
	const participantNames = useCell(
		EVENT_META_TABLE,
		eventId,
		EVENT_META_PARTICIPANT_NAMES_CELL,
	) as () => string[] | undefined;
	const availabilityTable = useTable(AVAILABILITY_TABLE) as () => Record<
		string,
		SlotMap
	>;

	return createMemo<Participant[]>(() => {
		const names = participantNames() ?? [];
		const avail = availabilityTable();

		return names.map((name) => ({
			name,
			slots: (avail[name] ?? {}) as SlotMap,
		}));
	});
}

export function useSelectedParticipant(
	eventId: string,
	participants: Accessor<Participant[]>,
): { currentName: Accessor<string>; storedName: Accessor<string | undefined> } {
	const storedName = useCell(
		SELECTED_PARTICIPANTS_TABLE,
		eventId,
		"name",
		deviceStore,
	) as () => string | undefined;
	const currentName = createMemo(() => {
		const stored = storedName();

		if (!stored) return "";

		return participants().some((p) => p.name === stored) ? stored : "";
	});

	return { currentName, storedName };
}

// ─── Event room store (synced via WebSocket) ─────────────────────────────────

export type EventRoomStore = ReturnType<typeof createMergeableStore>;
export type EventRoomStatus =
	| "loading"
	| "ready"
	| "not-found"
	| "network-error";

export interface RecentEventSummary {
	id: string;
	name: string;
	created: number;
}

interface EventRoomEntry {
	store: EventRoomStore;
	synchronizer: WsSynchronizer<ReconnectingWebSocket> | null;
	syncPromise: Promise<void> | null;
	persisterPromise: Promise<void>;
}

const eventRooms = new Map<string, EventRoomEntry>();

function getApiOrigin(): string {
	const origin = import.meta.env.VITE_API_ORIGIN;

	if (!origin) {
		throw new Error("Missing VITE_API_ORIGIN");
	}

	return origin;
}

function eventSyncUrl(eventId: string): string {
	const origin = getApiOrigin();
	const url = new URL(origin);

	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = `/api/events/${encodeURIComponent(eventId)}`;

	return url.toString();
}

function eventJsonUrl(eventId: string): string {
	const url = new URL(getApiOrigin());

	url.pathname = `/api/events/${encodeURIComponent(eventId)}/json`;

	return url.toString();
}

function writeEventMeta(
	store: EventRoomStore,
	event: Pick<AppEvent, "id" | "name" | "created">,
): void {
	store.setCell(EVENT_META_TABLE, event.id, EVENT_META_NAME_CELL, event.name);
	store.setCell(
		EVENT_META_TABLE,
		event.id,
		EVENT_META_CREATED_CELL,
		event.created,
	);
}

function writeEventSlots(
	store: EventRoomStore,
	event: Pick<AppEvent, "id" | "slotStartsUtcIso">,
): void {
	store.setCell(
		EVENT_META_TABLE,
		event.id,
		EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
		event.slotStartsUtcIso,
	);
}

function writeParticipantNames(
	store: EventRoomStore,
	eventId: string,
	participants: Participant[],
): void {
	store.setCell(
		EVENT_META_TABLE,
		eventId,
		EVENT_META_PARTICIPANT_NAMES_CELL,
		participants.map((participant) => participant.name),
	);
}

function syncParticipantAvailability(
	store: EventRoomStore,
	participants: Participant[],
): void {
	const nextParticipantNames = new Set(
		participants.map((participant) => participant.name),
	);

	if (store.hasTable(AVAILABILITY_TABLE)) {
		store
			.getRowIds(AVAILABILITY_TABLE)
			.filter((rowId) => !nextParticipantNames.has(String(rowId)))
			.map((rowId) => store.delRow(AVAILABILITY_TABLE, rowId));
	}

	participants.map((participant) => {
		const nextAvailabilityCellIds = new Set(Object.keys(participant.slots));

		Object.entries(participant.slots).map(([slotStartUtcIso, slotValue]) =>
			store.setCell(
				AVAILABILITY_TABLE,
				participant.name,
				slotStartUtcIso,
				slotValue,
			),
		);

		if (store.hasRow(AVAILABILITY_TABLE, participant.name)) {
			Object.keys(store.getRow(AVAILABILITY_TABLE, participant.name))
				.filter((cellId) => !nextAvailabilityCellIds.has(cellId))
				.map((cellId) =>
					store.delCell(AVAILABILITY_TABLE, participant.name, cellId, true),
				);
		}

		return participant;
	});
}

async function stopEventRoomSync(entry: EventRoomEntry): Promise<void> {
	entry.syncPromise = null;

	if (!entry.synchronizer) {
		return;
	}

	try {
		await entry.synchronizer.stopSync();
	} catch (error) {
		console.error("Failed to stop event room sync", error);
	}

	entry.synchronizer = null;
}

async function startEventRoomSync(
	eventId: string,
	entry: EventRoomEntry,
): Promise<void> {
	await stopEventRoomSync(entry);

	try {
		const ws = new ReconnectingWebSocket(eventSyncUrl(eventId), [], {
			maxRetries: Infinity,
		});
		const synchronizer = await createWsSynchronizer(entry.store, ws);

		await synchronizer.startSync();
		entry.synchronizer = synchronizer;
	} catch (error) {
		entry.synchronizer = null;
		console.error("Failed to start event room sync", error);
	}
}

function ensureEventRoomSync(eventId: string): void {
	const entry = eventRooms.get(eventId);

	if (!entry || entry.syncPromise) {
		return;
	}

	async function runSync() {
		try {
			await startEventRoomSync(eventId, entry!);
		} catch (error) {
			console.error("Failed to initialize event room sync", error);
		} finally {
			if (entry) entry.syncPromise = null;
		}
	}

	entry.syncPromise = runSync();
}

export function openEventStore(eventId: string): EventRoomStore {
	const existing = eventRooms.get(eventId);

	if (existing) {
		return existing.store;
	}

	const store = createMergeableStore(`sync-${eventId}`);

	// Keep the local mergeable state on-device so CRDT metadata survives reloads
	// before the websocket synchronizer reconnects to the shared event room.
	const persister = createLocalPersister(
		store,
		`timesweeper-events-main-${eventId}`,
	);

	async function initPersister() {
		try {
			await persister.load();
			await persister.startAutoSave();
		} catch (error) {
			console.error("Failed to initialize event room persister", error);
		}
	}

	const entry: EventRoomEntry = {
		store,
		synchronizer: null,
		syncPromise: null,
		persisterPromise: initPersister(),
	};

	eventRooms.set(eventId, entry);

	return store;
}

export function useEventStore(eventId: string): {
	store: EventRoomStore;
	status: () => EventRoomStatus;
} {
	const store = openEventStore(eventId);
	const [status, setStatus] = createSignal<EventRoomStatus>("loading");

	onMount(async () => {
		await eventRooms.get(eventId)!.persisterPromise;

		const hasData =
			store.getCell(EVENT_META_TABLE, eventId, EVENT_META_NAME_CELL) !==
			undefined;

		if (hasData) {
			ensureEventRoomSync(eventId);
			setStatus("ready");
			return;
		}

		try {
			const json = await getEventJson(eventId);

			if (!json) {
				setStatus("not-found");
				return;
			}

			createEvent(json);
			ensureEventRoomSync(eventId);
			setStatus("ready");
		} catch {
			setStatus("network-error");
		}
	});

	onCleanup(() => closeEventStore(eventId));

	return { store, status };
}

export async function closeEventStore(eventId: string): Promise<void> {
	const entry = eventRooms.get(eventId);

	if (!entry) {
		return;
	}

	await stopEventRoomSync(entry);
}

function requireWritableEventStore(eventId: string): EventRoomStore {
	return openEventStore(eventId);
}

export async function getEventJson(eventId: string): Promise<AppEvent | null> {
	const response = await fetch(eventJsonUrl(eventId));

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to load event JSON (${response.status})`);
	}

	return (await response.json()) as AppEvent;
}

export function createEvent(event: AppEvent): void {
	const store = requireWritableEventStore(event.id);

	store.transaction(() => {
		writeEventMeta(store, event);
		writeEventSlots(store, event);
		writeParticipantNames(store, event.id, event.participants);
		syncParticipantAvailability(store, event.participants);
	});
}

export async function updateEventSettings(
	eventId: string,
	settings: Pick<AppEvent, "name" | "participants">,
): Promise<void> {
	const store = requireWritableEventStore(eventId);
	const created = store.getCell(
		EVENT_META_TABLE,
		eventId,
		EVENT_META_CREATED_CELL,
	) as number;

	store.transaction(() => {
		writeEventMeta(store, {
			id: eventId,
			name: settings.name,
			created,
		});
		writeParticipantNames(store, eventId, settings.participants);
		syncParticipantAvailability(store, settings.participants);
	});
}
