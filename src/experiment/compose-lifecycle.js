// Keep lifecycle and evidence checks independent of Compose's active profiles.
const sharedServices = ['postgres', 'toxiproxy', 'adapter-service', 'callback-receiver', 'prometheus', 'grafana'];

export function resourceServicesFor(run) {
  const profile = { 'R-A': 'rest-async', 'K-A': 'kafka-async' }[run?.conditionId];
  if (!profile || run.composeProfile !== profile) throw new Error('Condition and Compose profile do not match.');
  return [profile, `gateway-${profile}`, ...sharedServices, ...(profile === 'kafka-async' ? ['redpanda'] : [])];
}

export function composeArguments(project, override, ...args) {
  if (!/^[a-z0-9][a-z0-9_-]+$/.test(project ?? '')) throw new Error('An explicit Compose project is required.');
  return ['compose', '-f', 'compose.yaml', ...(override ? ['-f', override] : []), '-p', project, ...args];
}

export function inspectProject(command, project) {
  const ids = command('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'], { capture: true })
    .trim().split(/\s+/).filter(Boolean);
  return ids.length ? JSON.parse(command('docker', ['inspect', ...ids], { capture: true })) : [];
}

export function stopComposeProject({ command, project, override }) {
  // Every service is profile-scoped. Without '*' down can succeed while doing nothing.
  // Never pass --volumes: data volumes and evidence must survive cleanup.
  command('docker', composeArguments(project, override, '--profile', '*', 'down', '--remove-orphans'));
  const remaining = inspectProject(command, project);
  if (remaining.length) throw new Error(`Project cleanup left containers behind: ${remaining.map((c) => c.Name).join(', ')}`);
  return { passed: true, checkedAt: new Date().toISOString(), project, remainingContainers: [] };
}

export function runtimeContainers(inspected) {
  return inspected.filter((c) => c.State?.Running).map((c) => ({
    Name: c.Name?.replace(/^\//, ''),
    Service: c.Config?.Labels?.['com.docker.compose.service'],
    ComposeProject: c.Config?.Labels?.['com.docker.compose.project'],
    OneOff: c.Config?.Labels?.['com.docker.compose.oneoff']?.toLowerCase() === 'true'
  }));
}

export function checkContainerSet(containers, expectedServices, { project, allowK6 = false, optionalServices = [] } = {}) {
  const counts = new Map();
  const unexpected = [];
  for (const container of containers ?? []) {
    let service = container.Service;
    // Read legacy stats using an exact project/service/replica match, never a substring.
    if (!service && project && container.Name?.startsWith(`${project}-`)) {
      const suffix = container.Name.slice(project.length + 1);
      service = expectedServices.find((s) => suffix.startsWith(`${s}-`) && /^\d+$/.test(suffix.slice(s.length + 1)));
      if (allowK6 && /^k6-run-[a-z0-9]+$/.test(suffix)) service = 'k6';
    }
    const oneOff = container.OneOff === true || (project && container.Name?.startsWith(`${project}-k6-run-`));
    const wrongProject = container.ComposeProject != null && container.ComposeProject !== project;
    if (wrongProject || !service || (oneOff && service !== 'k6')
      || (!expectedServices.includes(service) && !(allowK6 && service === 'k6' && oneOff))) {
      unexpected.push(container.Name ?? service ?? '<unknown>');
    } else counts.set(service, (counts.get(service) ?? 0) + 1);
  }
  const missing = expectedServices.filter((s) => !counts.has(s) && !optionalServices.includes(s));
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([service]) => service);
  return { passed: expectedServices.length > 0 && !missing.length && !unexpected.length && !duplicates.length, missing, unexpected, duplicates };
}

export function assertRunIsolation(command, project, run) {
  const inspected = inspectProject(command, project);
  const containers = runtimeContainers(inspected);
  const report = checkContainerSet(containers, resourceServicesFor(run), { project });
  if (!report.passed) throw new Error(`Run isolation failed: ${JSON.stringify(report)}`);
  return { checkedAt: new Date().toISOString(), project, containers, inspected, ...report };
}
