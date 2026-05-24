import { createMergeableStore } from "tinybase/mergeable-store";
import type { MergeableStore } from "tinybase/mergeable-store";
import { createDurableObjectSqlStoragePersister } from "tinybase/persisters/persister-durable-object-sql-storage";
import {
	getWsServerDurableObjectFetch,
	WsServerDurableObject,
} from "tinybase/synchronizers/synchronizer-ws-server-durable-object";
import {
	AVAILABILITY_TABLE,
	EVENT_META_CREATED_CELL,
	EVENT_META_TABLE,
	EVENT_META_NAME_CELL,
	EVENT_META_PARTICIPANT_NAMES_CELL,
	EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from "../../shared/tinybase-schema.ts";

interface Env {
	ROOM_ANALYTICS_DB: D1Database;
	EVENT_ROOMS: DurableObjectNamespace<EventRoom>;
}

interface EventParticipant {
	name: string;
	slots: Record<string, 1 | 2>;
}

interface EventJson {
	id: string;
	name: string;
	created: number;
	slotStartsUtcIso: string[];
	participants: EventParticipant[];
}

interface RoomAnalyticsSnapshot {
	eventId: string;
	name: string;
	created: number;
	daysCount: number;
	participantCount: number;
	participantsWithAvailabilityCount: number;
}

const wsFetch = getWsServerDurableObjectFetch("EVENT_ROOMS") as unknown as (
	request: Request,
	env: Env,
) => Response;

function matchEventJsonPath(pathname: string): string | null {
	const route = pathname.match(/^\/api\/events\/([^/]+)\/json$/);

	if (!route) {
		return null;
	}

	return decodeURIComponent(route[1]!);
}

export class EventRoom extends WsServerDurableObject<Env> {
	private readonly store: MergeableStore;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.store = createMergeableStore();
		this.store.addDidFinishTransactionListener(async () => {
			await this.persistAnalyticsSnapshot();
		});
	}

	createPersister() {
		return createDurableObjectSqlStoragePersister(
			this.store,
			this.ctx.storage.sql,
		);
	}

	async getPreview(eventId: string): Promise<EventJson | null> {
		if (!this.store.hasRow(EVENT_META_TABLE, eventId)) {
			return null;
		}

		const name = this.store.getCell(
			EVENT_META_TABLE,
			eventId,
			EVENT_META_NAME_CELL,
		);
		const created = this.store.getCell(
			EVENT_META_TABLE,
			eventId,
			EVENT_META_CREATED_CELL,
		);
		const slotStartsUtcIso = this.store.getCell(
			EVENT_META_TABLE,
			eventId,
			EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
		);
		const participantNames =
			(this.store.getCell(
				EVENT_META_TABLE,
				eventId,
				EVENT_META_PARTICIPANT_NAMES_CELL,
			) as string[]) ?? [];

		return {
			id: eventId,
			name: name as string,
			created: created as number,
			slotStartsUtcIso: slotStartsUtcIso as string[],
			participants: participantNames.map((participantName) => ({
				name: participantName,
				slots: this.store.hasRow(AVAILABILITY_TABLE, participantName)
					? ({
							...this.store.getRow(AVAILABILITY_TABLE, participantName),
						} as Record<string, 1 | 2>)
					: {},
			})),
		};
	}

	private getAnalyticsSnapshot(): RoomAnalyticsSnapshot | null {
		const eventId = this.getCurrentEventId();

		if (!eventId || !this.store.hasRow(EVENT_META_TABLE, eventId)) {
			return null;
		}

		const participantNames =
			(this.store.getCell(
				EVENT_META_TABLE,
				eventId,
				EVENT_META_PARTICIPANT_NAMES_CELL,
			) as string[]) ?? [];
		const slotStartsUtcIso =
			(this.store.getCell(
				EVENT_META_TABLE,
				eventId,
				EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
			) as string[]) ?? [];
		const participantsWithAvailabilityCount = participantNames.filter(
			(participantName) => {
				if (!this.store.hasRow(AVAILABILITY_TABLE, participantName)) {
					return false;
				}

				return (
					Object.keys(this.store.getRow(AVAILABILITY_TABLE, participantName))
						.length > 0
				);
			},
		).length;
		const daysCount = new Set(
			slotStartsUtcIso.map((slotStartUtcIso) => {
				return slotStartUtcIso.slice(0, 10);
			}),
		).size;

		return {
			eventId,
			name:
				(this.store.getCell(
					EVENT_META_TABLE,
					eventId,
					EVENT_META_NAME_CELL,
				) as string) ?? "",
			created:
				(this.store.getCell(
					EVENT_META_TABLE,
					eventId,
					EVENT_META_CREATED_CELL,
				) as number) ?? 0,
			daysCount,
			participantCount: participantNames.length,
			participantsWithAvailabilityCount,
		};
	}

	private getCurrentEventId(): string | null {
		const pathId = this.getPathId();
		const match = pathId.match(/^api\/events\/([^/]+)$/);

		if (!match) {
			return null;
		}

		return decodeURIComponent(match[1]!);
	}

	private async persistAnalyticsSnapshot(): Promise<void> {
		const snapshot = this.getAnalyticsSnapshot();

		if (!snapshot) {
			return;
		}

		await this.env.ROOM_ANALYTICS_DB.prepare(
			`
        INSERT INTO room_analytics (
          event_id,
          name,
          created,
          days_count,
          participant_count,
          participants_with_availability_count,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          name = excluded.name,
          created = excluded.created,
          days_count = excluded.days_count,
          participant_count = excluded.participant_count,
          participants_with_availability_count = excluded.participants_with_availability_count,
          updated_at = excluded.updated_at
      `,
		)
			.bind(
				snapshot.eventId,
				snapshot.name,
				snapshot.created,
				snapshot.daysCount,
				snapshot.participantCount,
				snapshot.participantsWithAvailabilityCount,
				Date.now(),
			)
			.run();
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const eventId = matchEventJsonPath(new URL(request.url).pathname);

		if (!eventId) {
			return wsFetch(request, env);
		}

		const stub = env.EVENT_ROOMS.get(
			env.EVENT_ROOMS.idFromName(`api/events/${encodeURIComponent(eventId)}`),
		);
		const preview = await stub.getPreview(eventId);

		if (!preview) {
			return Response.json(
				{ error: "Event not found" },
				{
					headers: {
						"Access-Control-Allow-Origin": "*",
					},
					status: 404,
				},
			);
		}

		return Response.json(preview, {
			headers: {
				"Access-Control-Allow-Origin": "*",
			},
		});
	},
};
