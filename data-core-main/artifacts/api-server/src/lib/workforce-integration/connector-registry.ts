/**
 * P20-E — Plugin-style connector registry (connector_key → implementation)
 */
import type { AttendanceConnector, ConnectorCapability } from "./types";

const registry = new Map<string, AttendanceConnector>();

export class ConnectorRegistry {
  register(connector: AttendanceConnector): void {
    if (registry.has(connector.connectorKey)) {
      throw new Error(`Connector already registered: ${connector.connectorKey}`);
    }
    registry.set(connector.connectorKey, connector);
  }

  resolve(connectorKey: string): AttendanceConnector {
    const c = registry.get(connectorKey);
    if (!c) throw new Error(`Unknown connector: ${connectorKey}`);
    return c;
  }

  has(connectorKey: string): boolean {
    return registry.has(connectorKey);
  }

  list(): Array<{ connectorKey: string; capabilities: ConnectorCapability[] }> {
    return [...registry.values()].map((c) => ({
      connectorKey: c.connectorKey,
      capabilities: [...c.capabilities],
    }));
  }

  validateConnectorKey(connectorKey: string): void {
    if (!registry.has(connectorKey)) {
      throw new Error(`Unsupported connector_key: ${connectorKey}`);
    }
  }
}

export const connectorRegistry = new ConnectorRegistry();
