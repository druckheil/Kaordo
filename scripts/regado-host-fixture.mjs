// Simulates one Regado host: devices, pool, desired state, plans and a converging operation
const terabyte = 1000204886016;
const poolUuid = '5f0c3c0e-6f51-4f4e-9d0e-6a1d1b7b0f11';
const ids = {
	a: 'wwn-0x50014ee0aaaa0001',
	b: 'wwn-0x50014ee0aaaa0002',
	c: 'wwn-0x50014ee0aaaa0003'
};

function device(id, serial, path, cls, health) {
	return {
		id,
		path,
		model: 'WDC WD10EZRX',
		serial,
		wwn: id.replace('wwn-', ''),
		size: terabyte,
		rotational: true,
		transport: 'sata',
		fsType: '',
		fsLabel: '',
		fsUuid: '',
		mountpoints: [],
		partitions:
			cls === 'pool'
				? [
						{
							path: `${path}1`,
							number: 1,
							size: 1048576,
							label: 'kaordo-boot',
							type: 'BIOS boot',
							fsType: '',
							fsLabel: '',
							fsUuid: '',
							mountpoints: []
						},
						{
							path: `${path}2`,
							number: 2,
							size: terabyte - 2097152,
							label: 'kaordo-pool',
							type: 'Linux filesystem',
							fsType: 'btrfs',
							fsLabel: 'kaordo',
							fsUuid: poolUuid,
							mountpoints: path === '/dev/sda' ? ['/srv/kaordo'] : []
						}
					]
				: [],
		class: cls,
		hostsSystem: false,
		health
	};
}

function member(devid, id, path) {
	return {
		devid,
		size: terabyte - 2097152,
		used: 214748364800,
		path: `${path}2`,
		deviceId: id,
		missing: false,
		errors: { write: 0, read: 0, flush: 0, corruption: 0, generation: 0 }
	};
}

export function createHostFixture(now) {
	const health = {
		state: 'passed',
		passed: true,
		temperatureC: 35,
		powerOnHours: 41000,
		reallocatedSectors: 0,
		pendingSectors: 0,
		uncorrectableSectors: 0,
		checkedAt: now
	};
	const devices = [
		device(ids.a, 'WD-A', '/dev/sda', 'pool', health),
		device(ids.b, 'WD-B', '/dev/sdb', 'pool', health),
		device(ids.c, 'WD-C', '/dev/sdc', 'blank', null)
	];
	const members = [member(1, ids.a, '/dev/sda'), member(2, ids.b, '/dev/sdb')];
	let desired = {
		revision: 1,
		pool: { devices: [ids.a, ids.b], dataProfile: 'raid1', metadataProfile: 'auto' },
		volumes: {},
		snapshots: {},
		integrity: { scrub: 'monthly', smartShort: 'weekly', smartLong: 'monthly' },
		backups: { targets: [], policies: [] },
		cleanup: { nixGenerationsDays: 30, releasesKeep: 5, journalDays: 30 },
		alerts: { poolWarningPercent: 80, poolCriticalPercent: 90, ntfy: null }
	};
	const operations = [];
	const changes = [];
	const checks = [];
	const tests = [];
	const plans = [];
	// Each read of a running operation advances it, so polling drives it to completion
	let operationReads = 0;

	function plan(document) {
		const steps = [];
		const issues = [];
		for (const id of document.pool.devices.filter((id) => !desired.pool.devices.includes(id))) {
			const added = devices.find((item) => item.id === id);
			steps.push({
				kind: 'add',
				device: id,
				summary: `Erase ${added.model} (${added.serial}) and add it to the pool`,
				confirm: added.serial
			});
		}
		if (document.pool.dataProfile !== desired.pool.dataProfile)
			steps.push({
				kind: 'convert',
				data: document.pool.dataProfile,
				metadata: document.pool.devices.length >= 3 ? 'raid1c3' : 'raid1',
				summary: `Rewrite files with ${document.pool.dataProfile === 'raid1c3' ? 'three' : 'two'} copies`
			});
		for (const id of desired.pool.devices.filter((id) => !document.pool.devices.includes(id))) {
			if (document.pool.devices.length < 2)
				issues.push('Two copies need at least two devices; add a device before removing this one.');
			else steps.push({ kind: 'remove', device: id, summary: `Move data off ${id} and remove it` });
		}
		return { steps, issues };
	}

	function advance() {
		const running = operations.find((item) => item.state === 'running');
		if (!running) return;
		operationReads++;
		if (running.kind !== 'pool.apply') {
			const [stage] = running.stages;
			stage.progress = { done: 50, total: 100, unit: 'percent' };
			if (operationReads > 1) {
				stage.state = running.state = 'succeeded';
				delete stage.progress;
				running.finishedAt = new Date().toISOString();
			}
			return;
		}
		const [prepare, add, convert] = running.stages;
		if (operationReads === 1) {
			prepare.state = 'succeeded';
			add.state = 'running';
			add.progress = { done: 1, total: 2, unit: 'steps' };
			add.detail = 'Adding /dev/sdc2 to the pool';
		} else if (operationReads === 2) {
			add.state = 'succeeded';
			delete add.progress;
			delete add.detail;
			convert.state = 'running';
			convert.progress = { done: 60, total: 200, unit: 'chunks' };
		} else {
			convert.state = 'succeeded';
			delete convert.progress;
			running.state = 'succeeded';
			running.finishedAt = new Date().toISOString();
			devices[2].class = 'pool';
			devices[2].health = health;
			members.push(member(3, ids.c, '/dev/sdc'));
		}
	}

	function facts() {
		return {
			host: {
				name: 'fixture-server',
				machineId: 'f'.repeat(32),
				firmware: 'bios',
				poolMount: '/srv/kaordo'
			},
			devices,
			pool: {
				uuid: poolUuid,
				label: 'kaordo',
				mount: '/srv/kaordo',
				members,
				dataProfiles: [desired.pool.dataProfile],
				metadataProfiles: [members.length >= 3 ? 'raid1c3' : 'raid1'],
				systemProfiles: [members.length >= 3 ? 'raid1c3' : 'raid1'],
				deviceSize: terabyte * members.length,
				allocated: 429496729600,
				used: 400000000000,
				freeEstimated: 700000000000,
				dataRatio: 2
			},
			desired,
			drift: { steps: [], issues: [] }
		};
	}

	// Returns the response for a host route, or undefined when the path is not a host route
	function handle(request, url) {
		const path = url.pathname.replace(/^\/v1\/admin\/hosts\/local/, '');
		if (path === url.pathname) return undefined;
		if (path === '' && request.method() === 'GET') return facts();
		if (path === '/state/plan') {
			const document = request.postDataJSON();
			plans.push(document);
			return plan(document);
		}
		if (path === '/state' && request.method() === 'PUT') {
			const change = request.postDataJSON();
			changes.push(change);
			const previous = desired;
			desired = { ...change.document, revision: previous.revision + 1 };
			// Like the agent, only a changed pool (or an explicit convergence) starts disk work
			if (JSON.stringify(previous.pool) === JSON.stringify(desired.pool) && !change.converge)
				return { document: desired, previous, operation: null };
			const operation = {
				id: '01999111-2222-7333-8444-000000000001',
				kind: 'pool.apply',
				target: `revision ${desired.revision}`,
				reason: change.reason,
				requestedBy: '01999111-2222-7333-8444-555555555551',
				state: 'running',
				cancellable: true,
				stages: [
					{ name: 'Prepare WD-C', state: 'running' },
					{ name: 'Add WD-C', state: 'queued' },
					{ name: 'Rewrite with three copies', state: 'queued' }
				],
				createdAt: new Date().toISOString(),
				startedAt: new Date().toISOString()
			};
			operations.unshift(operation);
			operationReads = 0;
			return { document: desired, previous, operation };
		}
		if (path === '/alerts')
			return {
				alerts: [
					{
						key: 'backup.none',
						severity: 'warning',
						summary:
							'No backup target is configured. Two copies survive a failed disk, not deletion or losing the host.',
						firstSeen: now,
						lastSeen: now
					},
					{
						key: 'pool.usage',
						severity: 'warning',
						summary: 'The pool is 82% full.',
						firstSeen: now,
						lastSeen: now,
						resolvedAt: now
					}
				]
			};
		if (path === '/alerts/test') {
			tests.push(desired.alerts.ntfy);
			return { ligo: true, ntfy: desired.alerts.ntfy ? 'sent' : 'not configured' };
		}
		if (path === '/operations' && request.method() === 'POST') {
			const check = request.postDataJSON();
			checks.push(check);
			const operation = {
				id: `01999111-2222-7333-8444-00000000010${checks.length}`,
				kind: check.kind,
				reason: check.reason,
				requestedBy: '01999111-2222-7333-8444-555555555551',
				state: 'running',
				cancellable: true,
				stages: [{ name: 'Verify every copy', state: 'running' }],
				createdAt: new Date().toISOString(),
				startedAt: new Date().toISOString()
			};
			operations.unshift(operation);
			operationReads = 0;
			return operation;
		}
		if (path === '/operations') {
			advance();
			return { items: operations };
		}
		const detail = path.match(/^\/operations\/([^/]+)$/);
		if (detail) {
			const operation = operations.find((item) => item.id === detail[1]);
			return {
				...operation,
				log: [{ at: operation.createdAt, message: 'Wiping signatures on /dev/sdc' }]
			};
		}
		return undefined;
	}

	return { handle, changes, plans, checks, tests };
}
