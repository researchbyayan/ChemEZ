import importlib.util
from pathlib import Path
import sqlite3
import pytest
from chemez.storage import Store
spec=importlib.util.spec_from_file_location('backup',Path(__file__).resolve().parents[2]/'scripts/backup-data.py')
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)

def test_wal_backup_restores_images_modes_and_settings_without_overwrite(tmp_path):
    store=Store(tmp_path/'live')
    store.save_config({'provider':'openai','model':'chat','endpoint':''})
    store.save_config({'provider':'gemini','model':'vision','endpoint':''},2)
    cid=store.create('Recovery test')
    original={'text':'Image question','images':[{'name':'test.png','mime':'image/png','data':'YWJj'}],'image_observations':'Visible ethanol'}
    store.add(cid,'user',original)
    store.add(cid,'assistant',[{'id':'a','type':'markdown','text':'Ethanol'}],response_style='tutor')
    snapshot=backup.copy_database(tmp_path/'live/chemez.sqlite3',tmp_path/'snapshot.sqlite3')
    recovery=tmp_path/'recovery';recovery.mkdir()
    backup.copy_database(snapshot,recovery/'chemez.sqlite3')
    restored=Store(recovery)
    assert restored.messages(cid)==store.messages(cid)
    assert restored.config(2)==store.config(2)
    with pytest.raises(FileExistsError):backup.copy_database(snapshot,recovery/'chemez.sqlite3')
    store.delete(cid)
    assert restored.messages(cid)[0]['content']==original
    assert restored.messages(cid)[1]['response_style']=='tutor'


def test_invalid_source_does_not_leave_a_backup(tmp_path):
    source=tmp_path/'other.sqlite3'
    sqlite3.connect(source).close()
    with pytest.raises(ValueError):backup.copy_database(source,tmp_path/'no.sqlite3')
    assert not (tmp_path/'no.sqlite3').exists()
