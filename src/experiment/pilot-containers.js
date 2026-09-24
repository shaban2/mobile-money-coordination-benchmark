// A stop/start promise is unsafe for `docker run --rm` containers: stopping
// destroys the instance. Their owning application must manage reconnection.
export function assertRestorablePilotContainer(inspected, approved) {
  if (inspected?.Id !== approved.id || inspected?.Name !== `/${approved.name}`) {
    throw new Error(`Approved container identity changed: ${approved.name}.`);
  }
  if (inspected?.HostConfig?.AutoRemove !== false) {
    throw new Error(`Cannot safely stop/restore ${approved.name}: AutoRemove is enabled or unknown. Resolve its owning application's lifecycle before the pilot.`);
  }
}
