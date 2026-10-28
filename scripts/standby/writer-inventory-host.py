#!/usr/bin/env python3
"""Bounded host inventory; never print process arguments, environment or schedules."""
import json
import os
from pathlib import Path
import subprocess


def inspect(proc=Path('/proc'), etc=Path('/etc'), runner=subprocess.run, own_pid=None):
    if own_pid is None:
        own_pid = os.getpid()
    outside = unreadable = unit = 0
    for p in proc.iterdir():
        if not p.name.isdigit() or int(p.name) == own_pid:
            continue
        try:
            exe = Path(os.readlink(p / 'exe')).name
            cwd = os.readlink(p / 'cwd')
            group = (p / 'cgroup').read_text()
            env = (p / 'environ').read_bytes().split(b'\0')
            suspect = exe in ('node', 'nodejs', 'bun', 'deno', 'psql', 'pg_restore', 'pg_dump') or b'RIVALHUB_DB_TARGET=production' in env or 'rivalhub' in cwd.lower()
            if suspect:
                if '/rivalhub-production.service' in group:
                    unit += 1
                else:
                    outside += 1
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            unreadable += 1
    # Scheduled entries need attribution; never infer safety from their names.
    timers = runner(['systemctl', 'list-timers', '--all', '--no-legend', '--no-pager'], check=True, capture_output=True, text=True, timeout=10).stdout
    timer_count = sum(bool(line.strip()) for line in timers.splitlines())
    cron_count = 0
    paths = [etc / 'crontab', *(etc / 'cron.d').iterdir()]
    for path in paths:
        if path.is_file():
            cron_count += sum(bool(line.strip()) and not line.lstrip().startswith('#') for line in path.read_text().splitlines())
    for user in ('root', 'rivalhub-production'):
        result = runner(['crontab', '-u', user, '-l'], capture_output=True, text=True, timeout=5)
        if result.returncode not in (0, 1) or (result.returncode == 1 and 'no crontab' not in result.stderr.lower()):
            raise RuntimeError('crontab unavailable')
        cron_count += sum(bool(line.strip()) and not line.lstrip().startswith('#') for line in result.stdout.splitlines())
    return dict(unit=unit, outside=outside, unreadable=unreadable, unattributedTimers=timer_count, unattributedCronLines=cron_count)

def main():
    try:
        print(json.dumps({'host': inspect()}))
        return 0
    except Exception:
        print(json.dumps({'host': {'status': 'unavailable'}}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
