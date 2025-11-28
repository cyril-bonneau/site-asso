import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

export async function eventBridgePutEvents(eventEntry) {

    if (!eventEntry?.Source || !eventEntry?.DetailType) {
        throw new Error("eventBridgePutEvents: Source et DetailType sont obligatoires");
    }

    if (typeof eventEntry.Detail !== "string") {
        throw new Error("eventBridgePutEvents: Detail doit être une string (JSON.stringify ton payload)");
    }

    try {

        const response = await eventBridge.send(new PutEventsCommand({ Entries: [eventEntry] }));

        const { FailedEntryCount, Entries } = response;

        if (FailedEntryCount && FailedEntryCount > 0) {
            console.error("eventBridgePutEvents: Certaines entrées ont échoué", Entries);
            throw new Error("eventBridgePutEvents: Certaines entrées ont échoué");
        }

        return response

    } catch (error) {
        console.error("Error sending event to EventBridge:", error);
        throw error;
    }
}