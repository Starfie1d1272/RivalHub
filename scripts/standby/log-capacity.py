#!/usr/bin/env python3
"""Read-only Linux disk/journal snapshot. Journal messages never leave aggregation."""
import collections
import datetime
import json
import shutil
import subprocess
import threading

ROW_LIMIT = 200000
UNITS = {
    'rivalhub-production.service', 'rivalhub-standby.service',
    'caddy.service', 'mihomo.service', 'ssh.service',
}


def message_bytes(message):
    if isinstance(message, str):
        return len(message.encode('utf-8'))
    if isinstance(message, list) and all(isinstance(n, int) and 0 <= n <= 255 for n in message):
        return len(message)
    return 0


def summarize(lines):
    counts = collections.Counter()
    sizes = collections.Counter()
    malformed = 0
    for line in lines:
        try:
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError()
        except (ValueError, TypeError):
            malformed += 1
            continue
        unit = row.get('_SYSTEMD_UNIT')
        unit = unit if isinstance(unit, str) and unit in UNITS else 'other'
        counts[unit] += 1
        sizes[unit] += message_bytes(row.get('MESSAGE'))
    return {
        'entries': sum(counts.values()), 'messageBytes': sum(sizes.values()),
        'malformedRows': malformed,
        'units': [{'unit': unit, 'entries': counts[unit], 'messageBytes': sizes[unit]}
                  for unit in sorted(counts)],
    }


def journal_window(start, end):
    command = ['journalctl', '--namespace=*', '--since', start, '--until', end,
               '--lines=' + str(ROW_LIMIT), '--output=json',
               '--output-fields=_SYSTEMD_UNIT,MESSAGE', '--no-pager', '--quiet']
    try:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              text=True, encoding='utf-8', errors='replace') as process:
            timeout = threading.Timer(60, process.kill)
            timeout.start()
            try:
                result = summarize(process.stdout)
                code = process.wait()
            finally:
                timeout.cancel()
    except OSError:
        return {'available': False}
    result.update({'available': code == 0, 'rowLimit': ROW_LIMIT,
                   'possiblyTruncated': result['entries'] + result['malformedRows'] >= ROW_LIMIT})
    return result


def allocated(path):
    try:
        result = subprocess.run(['du', '-sx', '-B1', path], capture_output=True,
                                text=True, timeout=30, check=True)
        return int(result.stdout.split()[0])
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp = lambda hours: (now - datetime.timedelta(hours=hours)).strftime('%Y-%m-%d %H:%M:%S UTC')
    disk = shutil.disk_usage('/')
    report = {
        'sampledAt': now.isoformat(),
        'rootDisk': {'totalBytes': disk.total, 'usedBytes': disk.used, 'freeBytes': disk.free},
        'allocatedBytes': {path: allocated(path) for path in
                           ['/var/log', '/var/log/journal', '/run/log/journal',
                            '/opt/rivalhub-production', '/opt/rivalhub-standby']},
        'journalWindows': [
            {'from': timestamp(24), 'to': timestamp(0), **journal_window(timestamp(24), timestamp(0))},
            {'from': timestamp(48), 'to': timestamp(24), **journal_window(timestamp(48), timestamp(24))},
        ],
        'limitations': [
            'Message bytes exclude journal metadata, indexes and compression; they are not disk growth.',
            'Windows include only retained entries readable by this operator; root is recommended.',
            'Unavailable or truncated windows cannot establish total volume.',
            'A disk snapshot does not predict match-peak load; compare snapshots around the event.',
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
