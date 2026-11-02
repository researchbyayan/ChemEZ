"""Read-only timing evidence; no network or model credentials used."""
import json,pathlib,statistics,subprocess,sys,time,importlib.metadata as metadata
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'backend'))
from chemez import local_tools
cold={}
for name,question in [('units','convert 250 mg to g'),('formula','molar mass of NaOH'),('balance','balance C2H6 + O2 -> CO2 + H2O')]:
 start=time.perf_counter();result=local_tools.answer(question);cold[name]=(time.perf_counter()-start)*1000
 assert result
warm={}
for name,question in [('units','convert 250 mg to g'),('formula','molar mass of NaOH'),('balance','balance C2H6 + O2 -> CO2 + H2O'),('unrelated','hello')]:
 samples=[]
 for _ in range(100):
  start=time.perf_counter();local_tools.answer(question);samples.append((time.perf_counter()-start)*1000)
 warm[name]={'median_ms':statistics.median(samples),'max_ms':max(samples)}
packages={}
for name in ('pint','molmass','flexcache','flexparser','platformdirs'):
 d=metadata.distribution(name);packages[name]={'version':d.version,'installed_bytes':sum(d.locate_file(f).stat().st_size for f in d.files or [] if d.locate_file(f).is_file())}
probe=subprocess.run([sys.executable,'-c',"import sys;sys.path.insert(0,'backend');import chemez.app;print('pint' in sys.modules,'molmass' in sys.modules)"],cwd=root,capture_output=True,text=True,check=True)
report={'first_use_ms':cold,'warm':warm,'packages':packages,'backend_eagerly_imports_tools':probe.stdout.strip(),'notes':['Development machine timings, not installer or clean-machine results.','No pre-change warmed baseline; cold import timings are filesystem-cache sensitive.','First use is off the async event loop; subsequent unit registry reuse is cached.']}
path=root/'evaluation/local-tools-performance.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
