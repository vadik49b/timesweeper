import { Provider } from "tinybase/ui-solid";
import { useEventStore } from "./db";
import Grid from "./Grid";

interface Props {
	eventId: string;
}

export default function GridContainer(props: Props) {
	const { store, status } = useEventStore(props.eventId);

	return (
		<Provider store={store}>
			<Grid eventId={props.eventId} status={status} />
		</Provider>
	);
}
