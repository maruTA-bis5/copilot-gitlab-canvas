export async function replacePanelEntry(registry, instanceId, entry) {
  const previous = registry.get(instanceId);
  if (previous && previous !== entry) {
    await previous.server.close();
    if (registry.get(instanceId) === previous) {
      registry.delete(instanceId);
    }
  }
  registry.set(instanceId, entry);
}

export async function closePanelEntry(registry, instanceId, expectedEntry) {
  const entry = registry.get(instanceId);
  if (!entry || (expectedEntry && entry !== expectedEntry)) {
    return false;
  }
  await entry.server.close();
  if (registry.get(instanceId) === entry) {
    registry.delete(instanceId);
  }
  return true;
}
