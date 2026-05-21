import { connectorRegistry } from "./connector-registry";
import { genericWebhookConnector } from "./connectors/generic-webhook";
import { genericRestPollConnector } from "./connectors/generic-rest-poll";
import { excelImportBridgeConnector } from "./connectors/excel-import-bridge";
import { directApiBridgeConnector } from "./connectors/direct-api-bridge";

let registered = false;

export function registerWorkforceConnectors(): void {
  if (registered) return;
  connectorRegistry.register(genericWebhookConnector);
  connectorRegistry.register(genericRestPollConnector);
  connectorRegistry.register(excelImportBridgeConnector);
  connectorRegistry.register(directApiBridgeConnector);
  registered = true;
}
