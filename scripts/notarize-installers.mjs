import {spawnSync} from 'node:child_process';import {readdir} from 'node:fs/promises';import path from 'node:path';
if(process.platform==='darwin'){
 for(const key of ['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'])if(!process.env[key])throw new Error('Missing notarization credential: '+key);
 for(const file of (await readdir('release')).filter(f=>f.endsWith('.dmg'))){
  const result=spawnSync('xcrun',['notarytool','submit',path.resolve('release',file),'--apple-id',process.env.APPLE_ID,'--team-id',process.env.APPLE_TEAM_ID,'--password',process.env.APPLE_APP_SPECIFIC_PASSWORD,'--wait','--output-format','json'],{encoding:'utf8'});
  if(result.status!==0||JSON.parse(result.stdout).status!=='Accepted')throw new Error('Installer notarization was not accepted. Review the protected CI notarization log.');
  if(spawnSync('xcrun',['stapler','staple',path.resolve('release',file)],{stdio:'inherit'}).status!==0)throw new Error('Installer stapling failed.');
 }
}
