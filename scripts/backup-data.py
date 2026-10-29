"""Create a consistent SQLite backup, or restore one into a NEW data directory.

Never overwrites a destination or copies operating-system/session API keys.
"""
import argparse
import os
import sqlite3
from pathlib import Path


def copy_database(source: Path, destination: Path):
    source=source.resolve(strict=True)
    if not destination.parent.is_dir():
        raise ValueError('Create the destination directory first.')
    # Exclusive creation prevents accidental overwrite, including symlinks.
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as origin:
        tables={row[0] for row in origin.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'settings','conversations','messages'}<=tables:
            raise ValueError('The source is not a ChemEZ conversation database.')
        if origin.execute('PRAGMA quick_check').fetchone()[0]!='ok':
            raise ValueError('The source database failed its integrity check.')
        descriptor=os.open(destination,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        os.close(descriptor)
        try:
            target=sqlite3.connect(destination)
            try:
                origin.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                    raise ValueError('The backup failed its integrity check.')
            finally:
                target.close()
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    return destination


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path,help='Existing ChemEZ SQLite database or backup')
    parser.add_argument('--output',required=True,type=Path,help='NEW backup file, or chemez.sqlite3 in a NEW recovery directory')
    args=parser.parse_args()
    try:
        print('Saved and integrity-checked:',copy_database(args.source,args.output))
    except (OSError,ValueError,sqlite3.Error) as exc:
        parser.exit(1,f'Backup was not created: {exc}\n')
